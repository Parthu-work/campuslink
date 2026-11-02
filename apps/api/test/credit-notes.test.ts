/**
 * Prompt 1b, R5: credit notes. Numbered from their own series on issue only, capped at what is left
 * of the invoice after earlier credit notes, mirrored tax, outstanding and read-only, isolation,
 * permissions and the PDF.
 */
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { financialYearOf, istDay } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { loadEnv } from '../src/config/env.js';
import { runInTenant } from '../src/lib/context.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { CreditNoteModel, InvoiceCounterModel, InvoiceModel } from '../src/modules/billing/billing.model.js';
import type { BillingService } from '../src/modules/billing/billing.service.js';

const ctx = testApp({
  env: loadEnv({
    NODE_ENV: 'test',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://*.localhost:5173',
    HIBP_ENABLED: 'false',
    BILLING_GST_REGISTERED: 'true',
    BILLING_SELLER_GSTIN: '36ABCDE1234F1Z5',
    BILLING_SELLER_STATE: '36',
    BILLING_SAC_CODE: '998314',
    BILLING_INVOICE_PREFIX: 'TB',
  }),
});
const billing = () => ctx.app.locals.services.billing as BillingService;
const DAY = 86_400_000;
const FY = financialYearOf(new Date());

let P: TestTenant, A: TestTenant, B: TestTenant;
let sa: TestUser, adminA: TestUser, adminB: TestUser, tpoA: TestUser, studentA: TestUser;
const asSa = () => api(ctx, P.host, sa.token);
const buyer = {
  legalName: 'A Educational Society',
  address: 'Survey 12, Demo Road, Hyderabad, Telangana 500001',
  gstin: null,
  stateCode: '36',
};
type View = {
  invoices: {
    id: string;
    number: string;
    totalPaise: number;
    creditedPaise: number;
    balancePaise: number;
    status: string;
  }[];
  creditNotes: {
    id: string;
    number: string | null;
    status: string;
    totalPaise: number;
    invoiceNumber: string;
  }[];
};

async function issueInvoice(t: TestTenant, unitPaise = 7500, dueDays = 30) {
  const d = await asSa()
    .post(`/platform/billing/${t._id}/invoices`)
    .send({
      periodStart: '2026-04-01',
      periodEnd: '2027-03-31',
      lines: [{ description: 'Placement plan', quantity: 1000, unitPaise }],
      dueDays,
    });
  expect(d.status, JSON.stringify(d.body)).toBe(201);
  const draft = d.body.data.invoices.find((i: { status: string }) => i.status === 'draft');
  const r = await asSa().post(`/platform/billing/${t._id}/invoices/${draft.id}/issue`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body.data as View).invoices.find((i) => i.id === draft.id) as View['invoices'][number];
}

const line = (unitPaise: number, quantity = 1) => ({
  description: 'Seats over-counted',
  quantity,
  unitPaise,
});
async function draftCredit(
  t: TestTenant,
  invoiceId: string,
  unitPaise: number,
  reason = 'Seats over-counted',
) {
  const r = await asSa()
    .post(`/platform/billing/${t._id}/invoices/${invoiceId}/credit-notes`)
    .send({ lines: [line(unitPaise)], reason });
  return r;
}
const newest = (v: View) => v.creditNotes[0] as View['creditNotes'][number];
const issueCredit = (t: TestTenant, id: string) =>
  asSa().post(`/platform/billing/${t._id}/credit-notes/${id}/issue`);

beforeAll(async () => {
  P = await makeTenant('cn-platform', 'platform');
  A = await makeTenant('cn-a');
  B = await makeTenant('cn-b');
  sa = await makeUser(ctx, P, { roles: ['SUPER_ADMIN'], mfa: true });
  adminA = await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true });
  adminB = await makeUser(ctx, B, { roles: ['COLLEGE_ADMIN'], mfa: true });
  tpoA = await makeUser(ctx, A, { roles: ['TPO'] });
  studentA = await makeUser(ctx, A, { roles: ['STUDENT'] });
  for (const t of [A, B])
    expect(
      (await asSa().patch(`/platform/billing/${t._id}`).send({ plan: 'placement', seats: 1000, buyer }))
        .status,
    ).toBe(200);
});

describe('credit notes (prompt 1b, R5)', () => {
  it('end to end: numbered on issue, the invoice unchanged, the balance down, a PDF that says what it adjusts', async () => {
    const inv = await issueInvoice(A);
    const before = await runInTenant(A._id, () => InvoiceModel.findById(inv.id).lean());
    const d = await draftCredit(A, inv.id, 7_500_00, 'Seats over-counted by 100');
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const draft = newest(d.body.data);
    // Mirrors the invoice's tax: intra-state at 18%, split in half.
    expect(d.body.data.creditNotes[0]).toMatchObject({
      status: 'draft',
      number: null,
      invoiceNumber: inv.number,
      taxablePaise: 7_500_00,
      gst: { kind: 'intra', cgstPaise: 675_00, sgstPaise: 675_00 },
      totalPaise: 8_850_00,
      reason: 'Seats over-counted by 100',
    });
    // Drafts are the platform's.
    expect((await api(ctx, A.host, adminA.token).get('/admin/billing')).body.data.creditNotes).toEqual([]);

    const r = await issueCredit(A, draft.id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const v = r.body.data as View;
    expect(newest(v)).toMatchObject({ status: 'issued', number: `CN/${FY}/0001` });
    expect(v.invoices.find((i) => i.id === inv.id)).toMatchObject({
      creditedPaise: 8_850_00,
      balancePaise: inv.totalPaise - 8_850_00,
      status: 'issued',
    });
    // The invoice's own record is untouched apart from the running credited total.
    const after = await runInTenant(A._id, () => InvoiceModel.findById(inv.id).lean());
    for (const k of [
      'number',
      'totalPaise',
      'taxablePaise',
      'lines',
      'gst',
      'issuedOn',
      'seller',
      'buyer',
    ] as const)
      expect(JSON.stringify(after?.[k]), k).toBe(JSON.stringify(before?.[k]));

    // Issuing again is a no-op: no second number.
    expect((await issueCredit(A, draft.id)).status).toBe(200);
    expect(await InvoiceCounterModel.findOne({ prefix: 'CN', fy: FY }).lean()).toMatchObject({ seq: 1 });

    // The college sees and downloads it; the PDF names the credit note, the invoice and the reason.
    const mine = (await api(ctx, A.host, adminA.token).get('/admin/billing')).body.data as View;
    expect(mine.creditNotes.map((c) => c.number)).toEqual([`CN/${FY}/0001`]);
    const pdf = await api(ctx, A.host, adminA.token)
      .get(`/admin/billing/credit-notes/${draft.id}/pdf`)
      .buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const doc = await PDFDocument.load(pdf.body as Buffer);
    expect(doc.getTitle()).toBe(`Credit note CN/${FY}/0001`);
    expect(doc.getSubject()).toBe(`Against invoice ${inv.number}. Reason: Seats over-counted by 100`);
    expect((await asSa().get(`/platform/billing/${A._id}/credit-notes/${draft.id}/pdf`)).status).toBe(200);

    await runInTenant(A._id, async () => {
      expect(await AuditModel.countDocuments({ action: 'billing.credit_note_issued' })).toBe(1);
    });
    await runInTenant(P._id, async () => {
      expect(await AuditModel.countDocuments({ action: 'platform.credit_note_issued' })).toBe(1);
    });
  });

  it('drafts never take a number: a voided draft leaves no gap', async () => {
    const inv = await issueInvoice(A);
    const first = newest((await draftCredit(A, inv.id, 100_00)).body.data);
    const voided = await asSa().post(`/platform/billing/${A._id}/credit-notes/${first.id}/void`);
    expect(voided.status).toBe(200);
    expect(newest(voided.body.data)).toMatchObject({ status: 'void', number: null });
    expect((await issueCredit(A, first.id)).status).toBe(404);
    const second = newest((await draftCredit(A, inv.id, 100_00)).body.data);
    const issued = newest((await issueCredit(A, second.id)).body.data);
    expect(issued.number).toBe(`CN/${FY}/0002`);
    // An issued credit note cannot be voided.
    expect((await asSa().post(`/platform/billing/${A._id}/credit-notes/${second.id}/void`)).status).toBe(404);
  });

  it('never more than what is left of the invoice after earlier credit notes, even issued at once', async () => {
    const inv = await issueInvoice(A, 100); // ₹1,000 + 18% = ₹1,180
    expect((await draftCredit(A, inv.id, 1_000_01)).status).toBe(409);
    const big = newest((await draftCredit(A, inv.id, 800_00)).body.data); // ₹944
    const small = newest((await draftCredit(A, inv.id, 300_00)).body.data); // ₹354
    expect((await issueCredit(A, big.id)).status).toBe(200);
    const refused = await issueCredit(A, small.id);
    expect(refused.status).toBe(409);
    const stillDraft = await runInTenant(A._id, () => CreditNoteModel.findById(small.id).lean());
    expect(stillDraft).toMatchObject({ status: 'draft', number: null });
    // Two drafts that each fit alone, issued at the same moment: exactly one goes through.
    const other = await issueInvoice(A, 100);
    const one = newest((await draftCredit(A, other.id, 600_00)).body.data);
    const two = newest((await draftCredit(A, other.id, 600_00)).body.data);
    const results = await Promise.all([issueCredit(A, one.id), issueCredit(A, two.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const credited = await runInTenant(A._id, () => InvoiceModel.findById(other.id).lean());
    expect(credited?.creditedPaise).toBe(708_00);
    // Not against a draft or another college's invoice.
    const bInv = await issueInvoice(B);
    expect((await draftCredit(A, bInv.id, 100)).status).toBe(404);
  });

  it('outstanding is total − payments − credit notes; a credit note that settles it ends read-only', async () => {
    const R = await makeTenant('cn-late');
    await makeUser(ctx, R, { roles: ['COLLEGE_ADMIN'], mfa: true });
    await asSa().patch(`/platform/billing/${R._id}`).send({ plan: 'connect', buyer });
    const inv = await issueInvoice(R, 100, 10); // ₹1,180
    const due = Date.parse(
      `${(await runInTenant(R._id, () => InvoiceModel.findById(inv.id).lean()))?.dueOn}T09:00:00+05:30`,
    );
    await runInTenant(R._id, () => billing().daily(new Date(due + 30 * DAY)));
    expect((await api(ctx, R.host).get('/tenant')).body.data.readOnly).toBe(true);
    // A part payment, then no payment can exceed what is left after a credit note.
    await asSa()
      .post(`/platform/billing/${R._id}/invoices/${inv.id}/payments`)
      .send({ amountPaise: 590_00, paidOn: istDay(new Date()), utr: 'CNPART0000001' })
      .expect(201);
    const half = newest((await draftCredit(R, inv.id, 250_00)).body.data); // ₹295
    await issueCredit(R, half.id).expect(200);
    expect(
      (
        await asSa()
          .post(`/platform/billing/${R._id}/invoices/${inv.id}/payments`)
          .send({ amountPaise: 295_01, paidOn: istDay(new Date()), utr: 'CNOVER0000001' })
      ).status,
    ).toBe(409);
    expect((await api(ctx, R.host).get('/tenant')).body.data.readOnly).toBe(true);
    // The rest by credit note: settled, and read-only ends at once.
    const rest = newest((await draftCredit(R, inv.id, 250_00)).body.data);
    const v = (await issueCredit(R, rest.id).expect(200)).body.data as View;
    expect(v.invoices.find((i) => i.id === inv.id)).toMatchObject({ status: 'paid', balancePaise: 0 });
    expect((await api(ctx, R.host).get('/tenant')).body.data.readOnly).toBe(false);
    const overview = (await asSa().get('/platform/billing')).body.data;
    expect(overview.find((r: { slug: string }) => r.slug === R.slug).outstandingPaise).toBe(0);
  });

  it('who sees what: permissions and isolation', async () => {
    const aNote = (await api(ctx, A.host, adminA.token).get('/admin/billing')).body.data.creditNotes[0];
    const path = `/admin/billing/credit-notes/${aNote.id}/pdf`;
    expect((await api(ctx, A.host).get(path)).status).toBe(401);
    for (const u of [tpoA, studentA]) expect((await api(ctx, A.host, u.token).get(path)).status).toBe(403);
    expect((await api(ctx, A.host, adminA.token).get(path)).status).toBe(200);
    // Another college's admin: not found, and not listed.
    expect((await api(ctx, B.host, adminB.token).get(path)).status).toBe(404);
    expect(
      (await api(ctx, B.host, adminB.token).get('/admin/billing')).body.data.creditNotes.map(
        (c: { id: string }) => c.id,
      ),
    ).not.toContain(aNote.id);
    // The platform routes are the platform's: 404 on a college host, and they check the college.
    const inv = (await api(ctx, A.host, adminA.token).get('/admin/billing')).body.data.invoices[0];
    const platformWrites = [
      [`/platform/billing/${A._id}/invoices/${inv.id}/credit-notes`, { lines: [line(1)], reason: 'Test' }],
      [`/platform/billing/${A._id}/credit-notes/${aNote.id}/issue`, {}],
      [`/platform/billing/${A._id}/credit-notes/${aNote.id}/void`, {}],
    ] as const;
    for (const [p, body] of platformWrites)
      expect((await api(ctx, A.host, adminA.token).post(p).send(body)).status, p).toBe(404);
    expect(
      (await api(ctx, A.host, adminA.token).get(`/platform/billing/${A._id}/credit-notes/${aNote.id}/pdf`))
        .status,
    ).toBe(404);
    expect((await asSa().get(`/platform/billing/${B._id}/credit-notes/${aNote.id}/pdf`)).status).toBe(404);
    expect((await asSa().post(`/platform/billing/${B._id}/credit-notes/${aNote.id}/issue`)).status).toBe(404);
    // Validation: lines and a reason.
    expect(
      (await asSa().post(`/platform/billing/${A._id}/invoices/${inv.id}/credit-notes`).send({ lines: [] }))
        .status,
    ).toBe(400);
  });
});
