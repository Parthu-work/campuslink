import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
  OFFER_PROOF_RETENTION_DAYS,
  ctcBand,
  type CtcBand,
  type DriveRoleType,
  type OfferSource,
  type OfferView,
} from '@campuslink/shared';
import { OfferModel, type OfferDoc } from './placements.model.js';
import type { FilesService } from '../files/files.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { companyKey } from '../../lib/company.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { AuthState } from '../../types.js';

const DAY = 24 * 3600_000;
const PAGE = 30;

export interface OffersDeps {
  files: FilesService;
  profiles: ProfilesService;
  notifications: NotificationsService;
}

/**
 * Offers (B7): from a drive selection (verified at once) or reported by the member with proof and
 * verified by the placement cell. The exact CTC is for the member and the cell only.
 */
export class OffersService {
  constructor(private readonly d: OffersDeps) {}

  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    return OfferModel.find({ userId: new Types.ObjectId(userId) })
      .select('companyName role ctcLpa offerDate type source status createdAt')
      .lean();
  }

  /**
   * Erasure anonymises: the offer stays in the college's placement record with branch, batch,
   * company and CTC band, without the member or the exact figure. The proof file is deleted.
   */
  async eraseFor(userId: string) {
    const u = new Types.ObjectId(userId);
    const rows = await OfferModel.find({ userId: u }).select('proofFileId').lean();
    for (const r of rows) if (r.proofFileId) await this.d.files.remove(r.proofFileId);
    // One random key for all of this member's offers, so reports still count them once.
    await OfferModel.updateMany(
      { userId: u },
      { $set: { userId: null, anonKey: randomUUID(), ctcLpa: null, proofFileId: null } },
    );
  }

  private async views(rows: OfferDoc[], withMember = false): Promise<OfferView[]> {
    const refs = withMember
      ? await this.d.profiles.refsFor(rows.flatMap((r) => (r.userId ? [r.userId] : [])))
      : new Map();
    return rows.map((r) => ({
      id: String(r._id),
      companyName: r.companyName,
      role: r.role,
      ctcLpa: r.ctcLpa ?? 0,
      ctcBand: r.ctcBand as OfferView['ctcBand'],
      offerDate: r.offerDate.toISOString(),
      type: r.type as DriveRoleType,
      source: r.source as OfferSource,
      status: r.status as OfferView['status'],
      reason: r.reason ?? null,
      driveId: r.driveId ? String(r.driveId) : null,
      hasProof: !!r.proofFileId,
      ...(withMember
        ? {
            member: {
              userId: r.userId ? String(r.userId) : null,
              name: r.userId ? (refs.get(String(r.userId))?.name ?? '') : '',
              branch: r.branch ?? null,
              gradYear: r.gradYear ?? null,
            },
            proofFileId: r.proofFileId ? String(r.proofFileId) : null,
          }
        : {}),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async mine(viewer: AuthState): Promise<OfferView[]> {
    const rows = await OfferModel.find({ userId: new Types.ObjectId(viewer.userId) })
      .sort({ offerDate: -1 })
      .limit(50)
      .lean<OfferDoc[]>();
    return this.views(rows);
  }

  /** A member reports an offer (off campus, PPO, internship conversion) with proof. */
  async report(
    viewer: AuthState,
    body: {
      companyName: string;
      role: string;
      ctcLpa: number;
      offerDate: string;
      type: DriveRoleType;
      source: OfferSource;
      proofFileId: string;
    },
    meta: RequestMetaLite,
  ): Promise<OfferView> {
    if (Date.parse(body.offerDate) > Date.now() + DAY) throw badRequest('The offer date is in the future');
    if (!(await this.d.files.pending(body.proofFileId, viewer.userId, 'offer_proof')))
      throw badRequest('Upload the proof again (it expired or is already used)');
    const proof = await this.d.files.claim(body.proofFileId, viewer.userId, 'offer_proof', null);
    const own = await this.d.profiles.own(viewer.userId);
    const doc = await OfferModel.create({
      userId: new Types.ObjectId(viewer.userId),
      companyKey: companyKey(body.companyName) || 'unknown',
      companyName: body.companyName,
      role: body.role,
      ctcLpa: body.ctcLpa,
      ctcBand: ctcBand(body.ctcLpa),
      offerDate: new Date(body.offerDate),
      type: body.type,
      source: body.source,
      proofFileId: new Types.ObjectId(proof.id),
      branch: own.branch,
      gradYear: own.gradYear,
    });
    await audit.record(
      {
        action: 'placements.offer_reported',
        actorId: viewer.userId,
        targetType: 'offer',
        targetId: String(doc._id),
        meta: { source: body.source },
      },
      meta,
    );
    return (await this.views([doc.toObject() as OfferDoc]))[0] as OfferView;
  }

  /** The member turned the offer down (it stays on their record as declined). */
  async decline(viewer: AuthState, id: string): Promise<OfferView> {
    const doc = await OfferModel.findOneAndUpdate(
      {
        _id: id,
        userId: new Types.ObjectId(viewer.userId),
        status: { $in: ['reported', 'verified'] },
      },
      { $set: { status: 'declined_by_student' } },
      { returnDocument: 'after' },
    ).lean<OfferDoc>();
    if (!doc) throw notFound('Offer');
    return (await this.views([doc]))[0] as OfferView;
  }

  async queue(status: string, cursor?: string) {
    const rows = await OfferModel.find({
      status,
      ...(cursor ? { _id: { $lt: new Types.ObjectId(cursor) } } : {}),
    })
      .sort({ _id: -1 })
      .limit(PAGE + 1)
      .lean<OfferDoc[]>();
    const page = rows.slice(0, PAGE);
    return {
      items: await this.views(page, true),
      nextCursor: rows.length > PAGE ? String(page.at(-1)?._id) : null,
    };
  }

  async decide(
    actorId: string,
    id: string,
    decision: 'verify' | 'reject',
    reason: string | undefined,
    meta: RequestMetaLite,
  ): Promise<OfferView> {
    const doc = await OfferModel.findOneAndUpdate(
      { _id: id, status: 'reported' },
      {
        $set:
          decision === 'verify'
            ? {
                status: 'verified',
                verifiedBy: new Types.ObjectId(actorId),
                verifiedAt: new Date(),
                reason: null,
              }
            : { status: 'rejected', reason: reason ?? null },
      },
      { returnDocument: 'after' },
    ).lean<OfferDoc>();
    if (!doc) {
      if (await OfferModel.exists({ _id: id })) throw conflict('This offer was already decided');
      throw notFound('Offer');
    }
    if (decision === 'verify' && doc.proofFileId)
      await this.d.files.deleteAfter(
        doc.proofFileId,
        new Date(Date.now() + OFFER_PROOF_RETENTION_DAYS * DAY),
      );
    await audit.record(
      {
        action: decision === 'verify' ? 'placements.offer_verified' : 'placements.offer_rejected',
        actorId,
        targetType: 'offer',
        targetId: id,
      },
      meta,
    );
    if (doc.userId)
      await this.d.notifications.notify(
        String(doc.userId),
        decision === 'verify' ? 'offer_verified' : 'offer_rejected',
        {
          company: doc.companyName,
          offerId: id,
        },
      );
    return (await this.views([doc], true))[0] as OfferView;
  }

  /** A drive selection: verified at once (the placement cell recorded it). Idempotent per drive. */
  async fromDrive(input: {
    userId: string;
    driveId: Types.ObjectId;
    companyName: string;
    role: string;
    ctcLpa: number;
    type: DriveRoleType;
    actorId: string;
    branch: string | null;
    gradYear: number | null;
  }): Promise<boolean> {
    const exists = await OfferModel.exists({
      driveId: input.driveId,
      userId: new Types.ObjectId(input.userId),
      status: { $ne: 'declined_by_student' },
    });
    if (exists) return false;
    await OfferModel.create({
      userId: new Types.ObjectId(input.userId),
      companyKey: companyKey(input.companyName) || 'unknown',
      companyName: input.companyName,
      role: input.role,
      ctcLpa: input.ctcLpa,
      ctcBand: ctcBand(input.ctcLpa),
      offerDate: new Date(),
      type: input.type,
      source: 'drive',
      driveId: input.driveId,
      status: 'verified',
      verifiedBy: new Types.ObjectId(input.actorId),
      verifiedAt: new Date(),
      branch: input.branch,
      gradYear: input.gradYear,
    });
    return true;
  }

  async pendingCount() {
    return OfferModel.countDocuments({ status: 'reported' });
  }

  /** Verified offers of these batches, for reports (B8; aggregated and suppressed there). */
  async verifiedFor(gradYears: number[]) {
    const rows = await OfferModel.find({ status: 'verified', gradYear: { $in: gradYears } })
      .select('userId anonKey branch gradYear companyKey companyName role ctcLpa ctcBand type source')
      .limit(50_000)
      .lean<OfferDoc[]>();
    return rows.map((r) => ({
      subject: r.userId ? String(r.userId) : (r.anonKey ?? String(r._id)),
      userId: r.userId ? String(r.userId) : null,
      branch: r.branch ?? null,
      gradYear: r.gradYear ?? null,
      companyKey: r.companyKey,
      companyName: r.companyName,
      role: r.role,
      ctcLpa: r.ctcLpa ?? null,
      ctcBand: r.ctcBand as CtcBand,
      type: r.type,
      source: r.source,
    }));
  }

  /** Files hook: offer proof is readable by whoever verifies offers (and its uploader). */
  async proofAccess(fileId: string, viewer: AuthState) {
    if (!viewer.permissions.has('outcomes:verify')) return null;
    return (await OfferModel.exists({ proofFileId: new Types.ObjectId(fileId) }))
      ? { name: 'offer-proof' }
      : null;
  }
}
