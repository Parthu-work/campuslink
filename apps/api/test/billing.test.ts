/**
 * Build B10: plans and entitlements, invoices (numbering under concurrency, GST maths, PDF),
 * payments (bank and online, idempotent), the webhook signature, reminders, read-only for
 * non-payment, seat counting, isolation and the permission matrix of the new routes.
 */
import { Types } from 'mongoose';
import type { Test } from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PLANS,
  allowanceStudents,
  annualPricePaise,
  financialYearOf,
  formatRupees,
  gstSplit,
  indianWords,
  istDay,
  mergeTerms,
  rupeesInWords,
} from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { loadEnv } from '../src/config/env.js';
import { runInTenant } from '../src/lib/context.js';
import { RazorpayPaymentProvider, StubPaymentProvider, hmacValid, sign } from '../src/lib/payments.js';
import { isTenantScoped, PLATFORM_MODELS } from '../src/db/models.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { clearTenantCache } from '../src/modules/tenants/tenant.cache.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { SessionModel } from '../src/modules/auth/session.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import {
  InvoiceCounterModel,
  InvoiceModel,
  PaymentModel,
  PlanSettingModel,
} from '../src/modules/billing/billing.model.js';
import { invalidatePlans } from '../src/modules/billing/entitlements.js';
import type { BillingService } from '../src/modules/billing/billing.service.js';
import { MIGRATIONS, runMigrations } from '../src/db/migrations.js';
import { MigrationModel } from '../src/modules/platform/migration.model.js';
import { createLogger } from '../src/lib/logger.js';
import { withPlatformScope } from '../src/lib/context.js';

const stub = new StubPaymentProvider('stub-webhook-secret-for-tests-0001');
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
  payments: stub,
});
const billing = () => ctx.app.locals.services.billing as BillingService;
const DAY = 86_400_000;

let P: TestTenant, A: TestTenant, B: TestTenant;
let sa: TestUser, adminA: TestUser, adminB: TestUser, tpoA: TestUser, facultyA: TestUser, studentA: TestUser;
const asSa = () => api(ctx, P.host, sa.token);
const buyerA = {
  legalName: 'A Educational Society',
  address: 'Survey 12, Demo Road, Hyderabad, Telangana 500001',
  gstin: null,
  stateCode: '36',
};

/** Drafts and issues an invoice for a college; returns the issued invoice view. */
async function issueFor(
  t: TestTenant,
  lines = [{ description: 'Placement plan', quantity: 1000, unitPaise: 7500 }],
  dueDays = 30,
) {
  const d = await asSa()
    .post(`/platform/billing/${t._id}/invoices`)
    .send({ periodStart: '2026-04-01', periodEnd: '2027-03-31', lines, dueDays });
  expect(d.status, JSON.stringify(d.body)).toBe(201);
  const draft = d.body.data.invoices.find((i: { status: string }) => i.status === 'draft');
  const r = await asSa().post(`/platform/billing/${t._id}/invoices/${draft.id}/issue`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data.invoices.find((i: { id: string }) => i.id === draft.id);
}

beforeAll(async () => {
  P = await makeTenant('billing-platform', 'platform');
  A = await makeTenant('billing-a');
  B = await makeTenant('billing-b');
  sa = await makeUser(ctx, P, { roles: ['SUPER_ADMIN'], mfa: true });
  adminA = await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true });
  adminB = await makeUser(ctx, B, { roles: ['COLLEGE_ADMIN'], mfa: true });
  tpoA = await makeUser(ctx, A, { roles: ['TPO'] });
  facultyA = await makeUser(ctx, A, { roles: ['FACULTY'] });
  studentA = await makeUser(ctx, A, { roles: ['STUDENT'] });
  for (const t of [A, B])
    expect(
      (
        await asSa()
          .patch(`/platform/billing/${t._id}`)
          .send({ plan: 'placement', seats: 1000, buyer: buyerA })
      ).status,
    ).toBe(200);
});

describe('plan maths (B10)', () => {
  it('GST: CGST + SGST in the seller’s state, IGST across states, UTGST in a UT, none unregistered', () => {
    const base = { taxablePaise: 75_000_00, ratePercent: 18, registered: true, sellerState: '36' };
    expect(gstSplit({ ...base, placeOfSupply: '36' })).toMatchObject({
      kind: 'intra',
      stateTaxName: 'SGST',
      cgstPaise: 6_750_00,
      sgstPaise: 6_750_00,
      igstPaise: 0,
      taxPaise: 13_500_00,
    });
    expect(gstSplit({ ...base, placeOfSupply: '37' })).toMatchObject({ kind: 'inter', igstPaise: 13_500_00 });
    expect(gstSplit({ ...base, sellerState: '04', placeOfSupply: '04' })).toMatchObject({
      kind: 'intra',
      stateTaxName: 'UTGST',
    });
    expect(gstSplit({ ...base, registered: false, placeOfSupply: '36' })).toMatchObject({
      kind: 'none',
      taxPaise: 0,
    });
    // Each half is rounded to the paisa: 9% of ₹0.05 is 0.45 paise → 0; 9% of ₹0.17 is 1.53 → 2.
    expect(gstSplit({ ...base, taxablePaise: 17, placeOfSupply: '36' })).toMatchObject({
      cgstPaise: 2,
      taxPaise: 4,
    });
    expect(gstSplit({ ...base, taxablePaise: 17, placeOfSupply: '37' })).toMatchObject({ igstPaise: 3 });
  });

  it('amounts in Indian words and digit grouping; financial years turn on 1 April (IST)', () => {
    expect(indianWords(1_20_000)).toBe('One Lakh Twenty Thousand');
    expect(indianWords(12_34_56_789)).toBe(
      'Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine',
    );
    expect(rupeesInWords(88_500_50)).toBe('Rupees Eighty-Eight Thousand Five Hundred and Fifty Paise Only');
    expect(formatRupees(1_20_000_00)).toBe('₹1,20,000.00');
    expect(formatRupees(12_34_56_789_00, { paise: false })).toBe('₹12,34,56,789');
    // 31 March 23:00 IST is still 2025-26; 1 April 00:30 IST is 2026-27.
    expect(financialYearOf(new Date('2026-03-31T17:30:00Z'))).toBe('2025-26');
    expect(financialYearOf(new Date('2026-03-31T19:00:00Z'))).toBe('2026-27');
  });

  it('prices and allowances: seats × price or the minimum, allowances sized to match', () => {
    const connect = mergeTerms(PLANS.connect);
    expect(annualPricePaise(connect, 1000)).toBe(60_000_00);
    expect(annualPricePaise(connect, 2000)).toBe(80_000_00);
    expect(allowanceStudents(connect, 1000)).toBe(1500);
    expect(connect.features).not.toContain('placements');
    expect(mergeTerms(PLANS.connect, { features: ['placements', 'study'] }).features).toEqual([
      'study',
      'placements',
    ]);
  });
});

describe('entitlements (B10)', () => {
  it('a switch applies only when the plan allows it and the college has it on', async () => {
    const C = await makeTenant('billing-connect');
    const admin = await makeUser(ctx, C, { roles: ['COLLEGE_ADMIN'], mfa: true });
    expect((await asSa().patch(`/platform/billing/${C._id}`).send({ plan: 'connect' })).status).toBe(200);
    expect((await api(ctx, C.host).get('/tenant')).body.data.features.placements).toBe(false);
    const drives = await api(ctx, C.host, admin.token).get('/admin/placements/drives');
    expect(drives.body.error?.code).toBe('FEATURE_DISABLED');
    // The college's own choice is kept, with the plan's list beside it.
    const settings = (await api(ctx, C.host, admin.token).get('/tenant/settings')).body.data;
    expect(settings.features.placements).toBe(true);
    expect(settings.planFeatures).not.toContain('placements');
    // A custom deal adds it back.
    await asSa()
      .patch(`/platform/billing/${C._id}`)
      .send({ terms: { features: [...PLANS.connect.features, 'placements'] } });
    expect((await api(ctx, C.host).get('/tenant')).body.data.features.placements).toBe(true);
  });

  it('the platform owner edits a plan; colleges on it follow, and the WhatsApp allowance comes from it', async () => {
    const r = await asSa().patch('/platform/plans/placement').send({ whatsappPerStudentMonthly: 6 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ id: 'placement', changed: ['whatsappPerStudentMonthly'] });
    const v = (await api(ctx, A.host, adminA.token).get('/admin/billing')).body.data;
    expect(v.usage.whatsapp.allowance).toBe(1600 * 6); // the minimum covers 1,600 students
    expect((await api(ctx, A.host, adminA.token).get('/admin/channels/usage')).body.data.allowance).toBe(
      9600,
    );
    await PlanSettingModel.deleteMany({});
    invalidatePlans();
    clearTenantCache();
  });
});

describe('invoices (B10)', () => {
  it('numbers are unique and gap-free under concurrency, one series per financial year', async () => {
    const fy = '2031-32';
    const numbers = await Promise.all(Array.from({ length: 25 }, () => billing().nextNumber(fy)));
    expect(new Set(numbers).size).toBe(25);
    expect(numbers.map((n) => Number(n.split('/')[2])).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
    expect(await billing().nextNumber('2032-33')).toBe('TB/2032-33/0001');
    expect(await InvoiceCounterModel.countDocuments({ prefix: 'TB', fy })).toBe(1);
  });

  it('issuing needs the buyer, fixes number, tax and parties, and renders a PDF', async () => {
    const N = await makeTenant('billing-nobuyer');
    const d = await asSa()
      .post(`/platform/billing/${N._id}/invoices`)
      .send({
        periodStart: '2026-04-01',
        periodEnd: '2027-03-31',
        lines: [{ description: 'Pilot extension', quantity: 1, unitPaise: 100_00 }],
      });
    const draft = d.body.data.invoices[0];
    expect(d.body.data.warnings).toContain('no_buyer');
    expect((await asSa().post(`/platform/billing/${N._id}/invoices/${draft.id}/issue`)).status).toBe(409);

    const inv = await issueFor(A);
    expect(inv).toMatchObject({
      status: 'issued',
      taxablePaise: 75_000_00,
      gst: { kind: 'intra', cgstPaise: 6_750_00, sgstPaise: 6_750_00 },
      totalPaise: 88_500_00,
      totalInWords: 'Rupees Eighty-Eight Thousand Five Hundred Only',
      sacCode: '998314',
    });
    expect(inv.number).toMatch(new RegExp(`^TB/${financialYearOf(new Date())}/\\d{4}$`));
    // Issuing again does nothing (the draft was claimed once).
    expect((await asSa().post(`/platform/billing/${A._id}/invoices/${inv.id}/issue`)).status).toBe(404);
    const pdf = await api(ctx, A.host, adminA.token)
      .get(`/admin/billing/invoices/${inv.id}/pdf`)
      .buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const platformPdf = await asSa().get(`/platform/billing/${A._id}/invoices/${inv.id}/pdf`).buffer(true);
    expect(platformPdf.status).toBe(200);
    // Out of state: IGST.
    await asSa()
      .patch(`/platform/billing/${B._id}`)
      .send({ buyer: { ...buyerA, legalName: 'B Trust', stateCode: '37' } });
    const igst = await issueFor(B);
    expect(igst.gst).toMatchObject({ kind: 'inter', igstPaise: 13_500_00 });
    await runInTenant(A._id, async () => {
      expect(await AuditModel.countDocuments({ action: 'billing.invoice_issued' })).toBeGreaterThan(0);
      expect(
        await NotificationModel.countDocuments({ userId: adminA.id, type: 'invoice_issued' }),
      ).toBeGreaterThan(0);
    });
  });

  it('drafts are the platform’s: the college sees issued invoices only', async () => {
    await asSa()
      .post(`/platform/billing/${A._id}/invoices`)
      .send({
        periodStart: '2026-04-01',
        periodEnd: '2027-03-31',
        lines: [{ description: 'Draft only', quantity: 1, unitPaise: 1 }],
      });
    const v = (await api(ctx, A.host, adminA.token).get('/admin/billing')).body.data;
    expect(v.invoices.every((i: { status: string }) => i.status !== 'draft')).toBe(true);
  });
});

describe('payments (B10)', () => {
  it('bank payments: partial, then full; a UTR once; never more than the balance; replays answer the same', async () => {
    const inv = await issueFor(A, [{ description: 'Connect plan', quantity: 1, unitPaise: 10_000_00 }]);
    const pay = (body: object, key?: string) => {
      const r = asSa().post(`/platform/billing/${A._id}/invoices/${inv.id}/payments`);
      if (key) r.set('Idempotency-Key', key);
      return r.send(body);
    };
    const first = await pay(
      { amountPaise: 5_000_00, paidOn: '2026-10-29', utr: 'utr0000000001' },
      'pay-key-0000000001',
    );
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const replay = await pay(
      { amountPaise: 5_000_00, paidOn: '2026-10-29', utr: 'utr0000000001' },
      'pay-key-0000000001',
    );
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((await pay({ amountPaise: 1_000_00, paidOn: '2026-10-29', utr: 'UTR0000000001' })).status).toBe(
      409,
    );
    expect((await pay({ amountPaise: 99_000_00, paidOn: '2026-10-29', utr: 'UTR0000000002' })).status).toBe(
      409,
    );
    const rest = await pay({ amountPaise: 6_800_00, paidOn: '2026-10-30', utr: 'UTR0000000003' });
    const after = rest.body.data.invoices.find((i: { id: string }) => i.id === inv.id);
    expect(after).toMatchObject({ status: 'paid', paidPaise: 11_800_00, balancePaise: 0 });
    expect(after.payments.map((p: { reference: string }) => p.reference)).toEqual([
      'UTR0000000001',
      'UTR0000000003',
    ]);
    await runInTenant(A._id, async () => {
      expect(await PaymentModel.countDocuments({ invoiceId: inv.id })).toBe(2);
      expect(
        await NotificationModel.countDocuments({ userId: adminA.id, type: 'payment_received' }),
      ).toBeGreaterThan(0);
    });
    await runInTenant(P._id, async () => {
      expect(await AuditModel.countDocuments({ action: 'platform.payment_recorded', actorId: sa.id })).toBe(
        2,
      );
    });
  });

  it('online: the college gets a link; a signed webhook marks the invoice paid once', async () => {
    const inv = await issueFor(A, [{ description: 'Placement plan', quantity: 1, unitPaise: 2_000_00 }]);
    const link = await api(ctx, A.host, adminA.token).post(`/admin/billing/invoices/${inv.id}/pay`);
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    const linkId = /plink_stub[a-f0-9]{12}/.exec(link.body.data.url)?.[0] ?? '';
    // The same link while it is open.
    expect(
      (await api(ctx, A.host, adminA.token).post(`/admin/billing/invoices/${inv.id}/pay`)).body.data.url,
    ).toBe(link.body.data.url);
    const delivery = stub.paidEvent(linkId, 'pay_stub000000000001');
    if (!delivery) throw new Error('no link');
    const send = (signature: string) =>
      api(ctx, P.host)
        .post('/webhooks/razorpay')
        .set('content-type', 'application/json')
        .set('x-razorpay-signature', signature)
        .set('x-razorpay-event-id', delivery.eventId)
        .send(delivery.body);
    expect((await send('0'.repeat(64))).status).toBe(401);
    expect((await send(delivery.signature)).body.data).toEqual({ result: 'recorded' });
    expect((await send(delivery.signature)).body.data).toEqual({ result: 'duplicate' });
    await runInTenant(A._id, async () => {
      expect(await PaymentModel.countDocuments({ invoiceId: inv.id, method: 'online' })).toBe(1);
      expect(await InvoiceModel.findById(inv.id).lean()).toMatchObject({
        status: 'paid',
        paidPaise: 2_360_00,
      });
    });
  });

  it('a webhook for a link that is not the invoice’s is ignored', async () => {
    const inv = await issueFor(B, [{ description: 'Placement plan', quantity: 1, unitPaise: 1_000_00 }]);
    const forged = JSON.stringify({
      event: 'payment_link.paid',
      payload: {
        payment_link: {
          entity: { id: 'plink_other', notes: { tenant_id: String(B._id), invoice_id: inv.id } },
        },
        payment: { entity: { id: 'pay_x', amount: 118_000, status: 'captured', created_at: 1_790_000_000 } },
      },
    });
    const r = await api(ctx, P.host)
      .post('/webhooks/razorpay')
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', sign(stub.secret, forged))
      .send(forged);
    expect(r.body.data).toEqual({ result: 'ignored' });
  });

  it('Razorpay: HMAC SHA256 signature, and a link request with no member data', async () => {
    const body = Buffer.from('{"event":"payment_link.paid"}');
    expect(hmacValid('whsec_test_secret_000', body, sign('whsec_test_secret_000', body))).toBe(true);
    expect(hmacValid('whsec_test_secret_000', body, sign('another-secret-0000000', body))).toBe(false);
    let sent: { url: string; headers: Record<string, string>; body: string } | null = null;
    const provider = new RazorpayPaymentProvider(
      { keyId: 'rzp_test_abcdef123456', keySecret: 'secret-xyz', webhookSecret: 'whsec_test_secret_000' },
      (async (url: string, opts: { headers?: Record<string, string>; body?: string }) => {
        sent = { url, headers: opts.headers ?? {}, body: String(opts.body) };
        return {
          status: 200,
          contentType: 'application/json',
          finalUrl: url,
          body: Buffer.from('{"id":"plink_1","short_url":"https://rzp.io/i/x"}'),
        };
      }) as never,
    );
    const link = await provider.createLink({
      reference: 'TB/2026-27/0001',
      amountPaise: 88_500_00,
      description: 'Invoice TB/2026-27/0001',
      payerName: 'A Educational Society',
      callbackUrl: 'https://a.example/admin/billing?paid=1',
      notes: { tenantId: 'a'.repeat(24), invoiceId: 'b'.repeat(24) },
    });
    expect(link).toEqual({ id: 'plink_1', url: 'https://rzp.io/i/x' });
    expect(sent).not.toBeNull();
    const req = sent as unknown as { url: string; headers: Record<string, string>; body: string };
    expect(req.url).toBe('https://api.razorpay.com/v1/payment_links');
    expect(req.headers.authorization).toBe(
      `Basic ${Buffer.from('rzp_test_abcdef123456:secret-xyz').toString('base64')}`,
    );
    const json = JSON.parse(req.body);
    expect(json).toMatchObject({ amount: 88_500_00, currency: 'INR', notify: { sms: false, email: false } });
    expect(Object.keys(json.customer)).toEqual(['name']);
  });
});

describe('reminders and read-only (B10)', () => {
  it('reminds 7 days before, on and 7 days after the due date (each once); read-only after 30 days', async () => {
    const R = await makeTenant('billing-late');
    const admin = await makeUser(ctx, R, { roles: ['COLLEGE_ADMIN'], mfa: true });
    const student = await makeUser(ctx, R, { roles: ['STUDENT'] });
    await asSa().patch(`/platform/billing/${R._id}`).send({ plan: 'connect', buyer: buyerA });
    const inv = await issueFor(R, [{ description: 'Connect plan', quantity: 1, unitPaise: 60_000_00 }], 10);
    const due = Date.parse(`${inv.dueOn}T09:00:00+05:30`);
    const at = (days: number) => runInTenant(R._id, () => billing().daily(new Date(due + days * DAY)));
    const sent = (type: string) =>
      runInTenant(R._id, () => NotificationModel.countDocuments({ userId: admin.id, type }));
    await at(-7);
    await at(-7);
    expect(await sent('invoice_due_soon')).toBe(1);
    await at(0);
    expect(await sent('invoice_due')).toBe(1);
    await at(1);
    expect((await runInTenant(R._id, () => InvoiceModel.findById(inv.id).lean()))?.status).toBe('overdue');
    await at(7);
    expect(await sent('invoice_overdue')).toBe(1);
    await at(29);
    expect((await api(ctx, R.host).get('/tenant')).body.data.readOnly).toBe(false);
    await at(30);
    expect(await sent('college_read_only')).toBe(1);
    expect((await api(ctx, R.host).get('/tenant')).body.data.readOnly).toBe(true);
    // Writes refused, reads and exports fine, account and privacy still work.
    const post = await api(ctx, R.host, student.token).post('/posts').send({ body: 'Hello' });
    expect(post.status).toBe(403);
    expect(post.body.error.code).toBe('READ_ONLY');
    expect((await api(ctx, R.host, student.token).get('/feed')).status).toBe(200);
    expect((await api(ctx, R.host, student.token).get('/me/export')).status).toBe(200);
    expect(
      (
        await api(ctx, R.host, student.token)
          .post('/me/consents')
          .send({ purpose: 'analytics_aggregate', granted: true })
      ).status,
    ).toBe(200);
    // Paying lifts it at once; nothing was deleted.
    const paid = await asSa()
      .post(`/platform/billing/${R._id}/invoices/${inv.id}/payments`)
      .send({ amountPaise: inv.totalPaise, paidOn: istDay(new Date()), utr: 'LATEUTR0000001' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect((await api(ctx, R.host).get('/tenant')).body.data.readOnly).toBe(false);
    await runInTenant(R._id, async () => {
      expect(await AuditModel.countDocuments({ action: 'billing.read_only_started' })).toBe(1);
      expect(await AuditModel.countDocuments({ action: 'billing.read_only_ended' })).toBe(1);
    });
  });

  it('read-only refuses every write route except the allowlisted ones (table-driven over the registry)', async () => {
    const L = await makeTenant('billing-readonly');
    await TenantModel.updateOne({ _id: L._id }, { $set: { 'billing.readOnlyAt': new Date() } });
    clearTenantCache();
    const registry = ctx.app.locals.registry as {
      module: string;
      spec: { method: string; path: string; scope?: string; readOnlyOk?: boolean };
    }[];
    const writes = registry.filter(
      (r) => r.spec.method !== 'get' && (r.spec.scope ?? 'college') !== 'platform',
    );
    expect(writes.length).toBeGreaterThan(100);
    const allowed: string[] = [];
    for (const { spec } of writes) {
      const path = spec.path.replace(/:[A-Za-z]+/g, '0123456789abcdef01234567');
      const r = await (api(ctx, L.host) as unknown as Record<string, (p: string) => Test>)[spec.method]!(
        path,
      ).send({});
      const label = `${spec.method.toUpperCase()} ${spec.path}`;
      if (spec.readOnlyOk) {
        allowed.push(label);
        expect(r.body?.error?.code, label).not.toBe('READ_ONLY');
      } else {
        expect(r.status, label).toBe(403);
        expect(r.body.error.code, label).toBe('READ_ONLY');
      }
    }
    // A new route opts in on purpose: this list changes only with a review.
    // Signing in and out, a member's own account, consents and privacy rights, safety and
    // moderation, sessions already booked, provider webhooks and paying.
    expect(allowed.sort()).toEqual(
      [
        'DELETE /auth/sessions/:id',
        'DELETE /me/blocks/:userId',
        'DELETE /me/deletion',
        'DELETE /me/job-alerts/:id',
        'PATCH /admin/users/:id/status',
        'PATCH /me',
        'POST /admin/billing/invoices/:invoiceId/pay',
        'POST /admin/moderation/actions',
        'POST /admin/moderation/appeals/:id/decision',
        'POST /admin/moderation/items/:id/decision',
        'POST /admin/moderation/questions/:id/decision',
        'POST /admin/reports/:id/resolve',
        'POST /appeals',
        'POST /auth/login',
        'POST /auth/login/mfa',
        'POST /auth/logout',
        'POST /auth/mfa/disable',
        'POST /auth/mfa/enable',
        'POST /auth/mfa/setup',
        'POST /auth/password/change',
        'POST /auth/password/forgot',
        'POST /auth/password/reset',
        'POST /auth/phone/start',
        'POST /auth/phone/verify',
        'POST /auth/refresh',
        'POST /auth/sessions/revoke-others',
        'POST /auth/verify-email',
        'POST /auth/verify-email/resend',
        'POST /bookings/:id/cancel',
        'POST /bookings/:id/join',
        'POST /conversations/:id/read',
        'POST /me/blocks',
        'POST /me/consents',
        'POST /me/deletion',
        'POST /me/guardian/confirm',
        'POST /me/guardian/manual',
        'POST /me/guardian/start',
        'POST /me/phone/change',
        'POST /me/phone/change/confirm',
        'POST /notifications/push/subscriptions',
        'POST /notifications/push/unsubscribe',
        'POST /notifications/read',
        'POST /reports',
        'POST /webhooks/razorpay',
        'POST /webhooks/whatsapp',
        'PUT /me/notification-preferences',
        'PUT /me/profile',
        'PUT /me/progress/settings',
      ].sort(),
    );
  });
});

describe('seats (B10)', () => {
  it('counts verified students and alumni active in 12 months, once each; over seats shows a banner', async () => {
    const S = await makeTenant('billing-seats');
    const admin = await makeUser(ctx, S, { roles: ['COLLEGE_ADMIN'], mfa: true });
    for (let i = 0; i < 3; i++) await makeUser(ctx, S, { roles: ['STUDENT'] });
    const unverified = await makeUser(ctx, S, { roles: ['STUDENT'] });
    const recent = await makeUser(ctx, S, { roles: ['ALUMNI'] });
    const stale = await makeUser(ctx, S, { roles: ['ALUMNI'] });
    const kept = await makeUser(ctx, S, { roles: ['ALUMNI'] });
    await runInTenant(S._id, async () => {
      await UserModel.updateOne({ _id: unverified.id }, { $set: { verified: false } });
      await UserModel.updateOne(
        { _id: recent.id },
        { $set: { lastLoginAt: new Date(Date.now() - 30 * DAY) } },
      );
      await UserModel.updateMany(
        { _id: { $in: [stale.id, kept.id] } },
        { $set: { lastLoginAt: new Date(Date.now() - 500 * DAY) } },
      );
      // Signed in long ago but kept a session going: active.
      await SessionModel.updateMany(
        { userId: { $in: [stale.id] } },
        { $set: { lastUsedAt: new Date(Date.now() - 400 * DAY) } },
      );
      await SessionModel.updateMany(
        { userId: kept.id },
        { $set: { lastUsedAt: new Date(Date.now() - 2 * DAY) } },
      );
      await billing().daily();
    });
    await TenantModel.updateOne({ _id: S._id }, { $set: { 'subscription.seats': 4 } });
    clearTenantCache();
    const v = (await api(ctx, S.host, admin.token).get('/admin/billing')).body.data;
    // Three verified students, the recently active alumnus and the one with a live session.
    expect(v.usage.seats).toMatchObject({ used: 5, contracted: 4 });
    expect(v.overSeats).toBe(true);
    expect((await api(ctx, S.host, admin.token).get('/admin/billing/notice')).body.data).toMatchObject({
      overSeats: true,
    });
    // Never blocks members.
    expect((await api(ctx, S.host, recent.token).get('/me')).status).toBe(200);
  });
});

describe('who sees what (B10)', () => {
  it('permission matrix for the new routes', async () => {
    const someInvoice = (await asSa().get(`/platform/billing/${A._id}`)).body.data.invoices.find(
      (i: { status: string }) => i.status !== 'draft',
    );
    const college = [
      ['get', '/admin/billing'],
      ['get', '/admin/billing/notice'],
      ['get', `/admin/billing/invoices/${someInvoice.id}/pdf`],
    ] as const;
    for (const [m, p] of college) {
      expect((await api(ctx, A.host)[m](p)).status, `anon ${p}`).toBe(401);
      for (const u of [tpoA, facultyA, studentA])
        expect((await api(ctx, A.host, u.token)[m](p)).status, p).toBe(403);
      expect((await api(ctx, A.host, adminA.token)[m](p)).status, p).toBe(200);
    }
    expect(
      (await api(ctx, A.host, studentA.token).post(`/admin/billing/invoices/${someInvoice.id}/pay`)).status,
    ).toBe(403);
    const platform = ['/platform/plans', '/platform/billing', `/platform/billing/${A._id}`];
    for (const p of platform) {
      expect((await api(ctx, A.host, adminA.token).get(p)).status, p).toBe(404);
      expect((await asSa().get(p)).status, p).toBe(200);
    }
    expect(
      (await api(ctx, A.host, adminA.token).patch(`/platform/billing/${A._id}`).send({ seats: 99 })).status,
    ).toBe(404);
  });

  it('a college reads only its own invoices; the platform overview has sums, not members', async () => {
    const bInvoice = (await asSa().get(`/platform/billing/${B._id}`)).body.data.invoices.find(
      (i: { status: string }) => i.status !== 'draft',
    );
    expect(
      (await api(ctx, A.host, adminA.token).get(`/admin/billing/invoices/${bInvoice.id}/pdf`)).status,
    ).toBe(404);
    expect(
      (await api(ctx, A.host, adminA.token).post(`/admin/billing/invoices/${bInvoice.id}/pay`)).status,
    ).toBe(404);
    const aIds = (await api(ctx, A.host, adminA.token).get('/admin/billing')).body.data.invoices.map(
      (i: { id: string }) => i.id,
    );
    expect(aIds).not.toContain(bInvoice.id);
    const bIds = (await api(ctx, B.host, adminB.token).get('/admin/billing')).body.data.invoices.map(
      (i: { id: string }) => i.id,
    );
    expect(bIds).toContain(bInvoice.id);
    await runInTenant(A._id, async () => expect(await InvoiceModel.exists({ _id: bInvoice.id })).toBeNull());
    const overview = (await asSa().get('/platform/billing')).body.data;
    const row = overview.find((r: { slug: string }) => r.slug === B.slug);
    expect(Object.keys(row).sort()).toEqual(
      [
        'name',
        'outstandingPaise',
        'overdue',
        'plan',
        'readOnly',
        'renewalDate',
        'seats',
        'seatsUsed',
        'slug',
        'tenantId',
      ].sort(),
    );
    expect(row.outstandingPaise).toBeGreaterThan(0);
    for (const u of [adminA, adminB, studentA]) expect(JSON.stringify(overview)).not.toContain(u.id);
  });

  it('the seller’s collections are platform models; invoices and payments are the college’s', () => {
    expect([...PLATFORM_MODELS].sort()).toEqual([
      'InvoiceCounter',
      'Migration',
      'PlanSetting',
      'Tenant',
      'WebhookReceipt',
    ]);
    expect(isTenantScoped(InvoiceCounterModel as never)).toBe(false);
    expect(isTenantScoped(PlanSettingModel as never)).toBe(false);
    expect(isTenantScoped(InvoiceModel as never)).toBe(true);
    expect(isTenantScoped(PaymentModel as never)).toBe(true);
  });
});

describe('the plan migration (B10)', () => {
  it('old plans and seat limits become the priced plans and seats; old documents load and save', async () => {
    const id = new Types.ObjectId();
    await TenantModel.collection.insertOne({
      _id: id,
      slug: 'billing-legacy',
      kind: 'college',
      status: 'active',
      branding: {
        displayName: 'Legacy College',
        shortName: 'LEG',
        primary: '#3fb8e6',
        secondary: '#6d5ae6',
        accent: '#f2b705',
        monogram: 'LG',
      },
      subscription: { plan: 'standard', seatLimit: 640, renewalDate: null },
    });
    await withPlatformScope('test:migrations', () => MigrationModel.deleteOne({ name: 'b10-plans' }));
    const m = MIGRATIONS.find((x) => x.name === 'b10-plans');
    if (!m) throw new Error('missing migration');
    await runMigrations(createLogger('silent'), [m]);
    const doc = await TenantModel.findById(id);
    expect(doc?.subscription).toMatchObject({ plan: 'connect', seats: 640 });
    expect(
      (doc?.toObject() as { subscription: Record<string, unknown> }).subscription.seatLimit,
    ).toBeUndefined();
    if (!doc) throw new Error('missing');
    doc.status = 'active';
    await doc.save();
  });
});
