import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  suppress,
  type FundView,
  type GivingSettingsView,
  type PledgeView,
  type fundBody,
  type givingSettingsBody,
  type pledgeBody,
  type pledgeReceiveBody,
  type pledgesQuery,
} from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import { conflict, notFound } from '../../lib/errors.js';
import { requireTenantId } from '../../lib/context.js';
import { plainText } from '../../lib/text.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { FilesService } from '../files/files.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import { findTenantById } from '../tenants/tenant.cache.js';
import {
  FundModel,
  GivingSettingsModel,
  PledgeModel,
  ReceiptCounterModel,
  type FundDoc,
  type GivingSettingsDoc,
  type PledgeDoc,
} from './alumni.model.js';
import { renderAcknowledgementPdf } from './alumni-pdf.js';

export const ACKNOWLEDGEMENT_JOB = 'alumni.acknowledgement';
const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
/** The Indian financial year of a date (April to March): `2026-27`. */
export const financialYear = (d: Date) => {
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};

export interface GivingDeps {
  profiles: ProfilesService;
  files: FilesService;
  jobs: JobQueue;
  notifications: NotificationsService;
}

/**
 * Giving (prompt 2, G6): the college publishes funds with targets and its own payment page or bank
 * details; alumni pledge and pay the college directly (money never passes through the platform);
 * the college records what it received, which gives the pledge a receipt number (once, from the
 * college's counter) and an acknowledgement PDF (a tax receipt only when the college says it is
 * registered for that). Received contributions feed the NAAC alumni engagement report.
 */
export class GivingService {
  track: Track = noTrack;
  constructor(private readonly d: GivingDeps) {}

  // ── Settings ─────────────────────────────

  async settings(): Promise<GivingSettingsView> {
    const s = await GivingSettingsModel.findOne({ key: 'college' }).lean<GivingSettingsDoc>();
    return {
      taxReceipts: s?.taxReceipts ?? false,
      registration: s?.registration ?? '',
      signatory: s?.signatory ?? '',
    };
  }

  async setSettings(actor: AuthState, body: z.output<typeof givingSettingsBody>, meta: RequestMetaLite) {
    await GivingSettingsModel.updateOne(
      { key: 'college' },
      {
        $set: {
          taxReceipts: body.taxReceipts,
          registration: plainText(body.registration),
          signatory: plainText(body.signatory),
        },
      },
      { upsert: true },
    );
    await audit.record(
      { action: 'giving.settings_changed', actorId: actor.userId, meta: { taxReceipts: body.taxReceipts } },
      meta,
    );
    return this.settings();
  }

  // ── Funds ─────────────────────────────

  private async fundViews(rows: FundDoc[]): Promise<FundView[]> {
    if (!rows.length) return [];
    const totals = await PledgeModel.aggregate<{
      _id: Types.ObjectId;
      received: number;
      pledged: number;
      donors: (Types.ObjectId | string | null)[];
    }>([
      { $match: { fundId: { $in: rows.map((f) => f._id) }, status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: '$fundId',
          received: { $sum: { $cond: [{ $eq: ['$status', 'received'] }, '$receivedPaise', 0] } },
          pledged: { $sum: { $cond: [{ $eq: ['$status', 'received'] }, 0, '$amountPaise'] } },
          donors: {
            $addToSet: {
              $cond: [{ $eq: ['$status', 'received'] }, { $ifNull: ['$userId', '$anonKey'] }, null],
            },
          },
        },
      },
    ]);
    const by = new Map(totals.map((t) => [String(t._id), t]));
    return rows.map((f) => {
      const t = by.get(String(f._id));
      return {
        id: String(f._id),
        title: f.title,
        purpose: f.purpose,
        description: f.description,
        targetPaise: f.targetPaise ?? null,
        payLink: f.payLink ?? null,
        bankDetails: f.bankDetails,
        status: f.status,
        receivedPaise: t?.received ?? 0,
        pledgedPaise: t?.pledged ?? 0,
        donors: suppress((t?.donors ?? []).filter((x) => x !== null).length),
      };
    });
  }

  async funds(viewer: AuthState): Promise<FundView[]> {
    const all = viewer.permissions.has('giving:manage');
    const rows = await FundModel.find(all ? {} : { status: 'open' })
      .sort({ status: 1, createdAt: -1 })
      .limit(100)
      .lean<FundDoc[]>();
    return this.fundViews(rows);
  }

  private fundFields(body: z.output<typeof fundBody>) {
    return {
      title: plainText(body.title),
      purpose: body.purpose,
      description: plainText(body.description),
      targetPaise: body.targetPaise,
      payLink: body.payLink,
      bankDetails: plainText(body.bankDetails),
      status: body.status,
    };
  }

  async createFund(actor: AuthState, body: z.output<typeof fundBody>, meta: RequestMetaLite) {
    const f = await FundModel.create(this.fundFields(body));
    await audit.record(
      { action: 'giving.fund_created', actorId: actor.userId, targetType: 'fund', targetId: String(f._id) },
      meta,
    );
    return (await this.fundViews([f.toObject() as FundDoc]))[0] as FundView;
  }

  async updateFund(actor: AuthState, id: string, body: z.output<typeof fundBody>, meta: RequestMetaLite) {
    const f = await FundModel.findOneAndUpdate(
      { _id: id },
      { $set: this.fundFields(body) },
      { returnDocument: 'after' },
    ).lean<FundDoc>();
    if (!f) throw notFound('Fund');
    await audit.record(
      {
        action: 'giving.fund_updated',
        actorId: actor.userId,
        targetType: 'fund',
        targetId: id,
        meta: { status: body.status },
      },
      meta,
    );
    return (await this.fundViews([f]))[0] as FundView;
  }

  // ── Pledges ─────────────────────────────

  private async pledgeViews(rows: PledgeDoc[], withPerson: boolean): Promise<PledgeView[]> {
    const funds = new Map(
      (
        await FundModel.find({ _id: { $in: [...new Set(rows.map((r) => String(r.fundId)))].map(oid) } })
          .select('title purpose')
          .lean<FundDoc[]>()
      ).map((f) => [String(f._id), f]),
    );
    const refs = withPerson
      ? await this.d.profiles.refsFor(rows.flatMap((r) => (r.userId ? [r.userId] : [])))
      : new Map();
    return rows.map((r) => {
      const f = funds.get(String(r.fundId));
      return {
        id: String(r._id),
        fund: { id: String(r.fundId), title: f?.title ?? '', purpose: f?.purpose ?? r.purpose },
        person: withPerson
          ? r.userId
            ? (refs.get(String(r.userId)) ?? {
                userId: String(r.userId),
                name: 'Former member',
                avatarFileId: null,
              })
            : { userId: '', name: 'Former member', avatarFileId: null }
          : null,
        amountPaise: r.amountPaise,
        status: r.status,
        reference: r.reference,
        receivedPaise: r.receivedPaise ?? null,
        receivedOn: r.receivedOn ? r.receivedOn.toISOString().slice(0, 10) : null,
        receiptNo: r.receiptNo ?? null,
        acknowledgement: !!r.ackFileId,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async pledge(viewer: AuthState, body: z.output<typeof pledgeBody>): Promise<PledgeView> {
    const f = await FundModel.findOne({ _id: body.fundId, status: 'open' }).lean<FundDoc>();
    if (!f) throw notFound('Fund');
    const p = await PledgeModel.create({
      userId: oid(viewer.userId),
      fundId: f._id,
      purpose: f.purpose,
      amountPaise: body.amountPaise,
    });
    await this.track(viewer.userId, 'pledge_made', { purpose: f.purpose });
    return (await this.pledgeViews([p.toObject() as PledgeDoc], false))[0] as PledgeView;
  }

  async myPledges(viewer: AuthState): Promise<PledgeView[]> {
    const rows = await PledgeModel.find({ userId: oid(viewer.userId) })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<PledgeDoc[]>();
    return this.pledgeViews(rows, false);
  }

  private async own(viewer: AuthState, id: string) {
    const p = await PledgeModel.findOne({ _id: id, userId: oid(viewer.userId) }).lean<PledgeDoc>();
    if (!p) throw notFound('Pledge');
    return p;
  }

  /** The member says they paid the college (its reference helps the college find the payment). */
  async markPaid(viewer: AuthState, id: string, reference: string): Promise<PledgeView> {
    const p = await this.own(viewer, id);
    const next = await PledgeModel.findOneAndUpdate(
      { _id: p._id, status: { $in: ['pledged', 'paid'] } },
      { $set: { status: 'paid', reference: plainText(reference) }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    ).lean<PledgeDoc>();
    if (!next) throw conflict('This pledge is already received or cancelled');
    return (await this.pledgeViews([next], false))[0] as PledgeView;
  }

  async cancel(viewer: AuthState, id: string): Promise<PledgeView> {
    const p = await this.own(viewer, id);
    const next = await PledgeModel.findOneAndUpdate(
      { _id: p._id, status: { $in: ['pledged', 'paid'] } },
      { $set: { status: 'cancelled' }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    ).lean<PledgeDoc>();
    if (!next) throw conflict('A received contribution cannot be cancelled');
    return (await this.pledgeViews([next], false))[0] as PledgeView;
  }

  async adminPledges(q: z.output<typeof pledgesQuery>): Promise<PledgeView[]> {
    const rows = await PledgeModel.find({
      ...(q.status ? { status: q.status } : {}),
      ...(q.fundId ? { fundId: oid(q.fundId) } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(300)
      .lean<PledgeDoc[]>();
    return this.pledgeViews(rows, true);
  }

  /**
   * The college records what it received. The pledge is claimed first (so two clicks record it
   * once), then numbered from the college's counter for the financial year of the receipt date.
   */
  async receive(
    actor: AuthState,
    id: string,
    body: z.output<typeof pledgeReceiveBody>,
    meta: RequestMetaLite,
  ) {
    const settings = await this.settings();
    const receivedOn = new Date(`${body.receivedOn}T00:00:00Z`);
    if (receivedOn.getTime() > Date.now() + 86_400_000) throw conflict('The receipt date is in the future');
    const claimed = await PledgeModel.findOneAndUpdate(
      { _id: id, status: { $in: ['pledged', 'paid'] } },
      {
        $set: {
          status: 'received',
          receivedPaise: body.amountPaise,
          receivedOn,
          receivedReference: plainText(body.reference),
          taxReceipt: settings.taxReceipts,
        },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    ).lean<PledgeDoc>();
    if (!claimed) {
      if (await PledgeModel.exists({ _id: id }))
        throw conflict('This pledge is already received or cancelled');
      throw notFound('Pledge');
    }
    const year = financialYear(receivedOn);
    const counter = await ReceiptCounterModel.findOneAndUpdate(
      { year },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' },
    ).lean<{ seq: number }>();
    const receiptNo = `${settings.taxReceipts ? 'RCPT' : 'ACK'}/${year}/${String(counter?.seq ?? 1).padStart(4, '0')}`;
    await PledgeModel.updateOne({ _id: claimed._id }, { $set: { receiptNo } });
    await audit.record(
      {
        action: 'giving.received',
        actorId: actor.userId,
        targetType: 'pledge',
        targetId: id,
        meta: { amountPaise: body.amountPaise, receiptNo },
      },
      meta,
    );
    await this.d.jobs.enqueue(
      ACKNOWLEDGEMENT_JOB,
      { tenantId: String(requireTenantId()), pledgeId: id },
      { jobId: `ack-${id}` },
    );
    return (await this.pledgeViews([{ ...claimed, receiptNo }], true))[0] as PledgeView;
  }

  /** Job (worker): the acknowledgement PDF, kept with the pledge; the member is told. */
  async onAcknowledge(job: TenantJob) {
    const p = await PledgeModel.findById(String(job.pledgeId)).lean<PledgeDoc>();
    if (!p || p.status !== 'received' || !p.receiptNo || !p.userId || p.ackFileId) return;
    const [tenant, settings, fund, name] = await Promise.all([
      findTenantById(requireTenantId()),
      this.settings(),
      FundModel.findById(p.fundId).select('title').lean<FundDoc>(),
      this.d.profiles.refsFor([p.userId]).then((m) => m.get(String(p.userId))?.name ?? ''),
    ]);
    const pdf = await renderAcknowledgementPdf({
      college: tenant?.branding.displayName ?? '',
      name,
      fund: fund?.title ?? '',
      purpose: p.purpose,
      amountPaise: p.receivedPaise ?? p.amountPaise,
      receivedOn: (p.receivedOn ?? new Date()).toISOString().slice(0, 10),
      reference: p.receivedReference || p.reference,
      receiptNo: p.receiptNo,
      tax: p.taxReceipt ? { registration: settings.registration } : null,
      signatory: settings.signatory,
    });
    const file = await this.d.files.storeAlumniPdf(String(p.userId), 'giving_acknowledgement', pdf);
    const res = await PledgeModel.updateOne(
      { _id: p._id, ackFileId: null },
      { $set: { ackFileId: new Types.ObjectId(file.id) } },
    );
    if (!res.modifiedCount) return void (await this.d.files.remove(file.id));
    await this.d.notifications.notify(p.userId, 'pledge_received', { pledgeId: String(p._id) });
  }

  /** The member's own acknowledgement, or any for the college's giving desk. */
  async acknowledgement(viewer: AuthState, id: string): Promise<{ data: Buffer; name: string }> {
    const p = await PledgeModel.findOne(
      viewer.permissions.has('giving:manage') ? { _id: id } : { _id: id, userId: oid(viewer.userId) },
    ).lean<PledgeDoc>();
    if (!p?.ackFileId || !p.receiptNo) throw notFound('Acknowledgement');
    return {
      data: await this.d.files.read(String(p.ackFileId)),
      name: `${p.receiptNo.replace(/\//g, '-')}.pdf`,
    };
  }

  /** NAAC alumni engagement: contributions the college received in a window, by contributor. */
  async receivedBetween(from: Date, to: Date): Promise<{ subject: string; amountPaise: number }[]> {
    const rows = await PledgeModel.find({ status: 'received', receivedOn: { $gte: from, $lt: to } })
      .select('userId anonKey receivedPaise')
      .limit(100_000)
      .lean<PledgeDoc[]>();
    return rows.map((r) => ({
      subject: r.userId ? String(r.userId) : (r.anonKey ?? String(r._id)),
      amountPaise: r.receivedPaise ?? 0,
    }));
  }

  // ── Privacy ─────────────────────────────

  async exportFor(userId: string) {
    return PledgeModel.find({ userId: oid(userId) })
      .select('fundId purpose amountPaise status reference receivedPaise receivedOn receiptNo createdAt')
      .lean();
  }

  /**
   * Pledges not received go. Received contributions are the college's financial record: they stay,
   * detached (`anonKey`), so totals and the NAAC report still add up; the acknowledgement PDF goes
   * with the member's files.
   */
  async eraseFor(userId: string) {
    const u = oid(userId);
    await PledgeModel.deleteMany({ userId: u, status: { $ne: 'received' } });
    const kept = await PledgeModel.find({ userId: u }).select('_id').lean();
    for (const p of kept)
      await PledgeModel.updateOne(
        { _id: p._id },
        { $set: { userId: null, anonKey: randomUUID(), ackFileId: null, reference: '' } },
      );
  }
}
