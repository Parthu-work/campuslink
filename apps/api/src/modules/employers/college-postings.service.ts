import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  EMPLOYER_LIMITS,
  EMPLOYER_PRICING_DEFAULT,
  driveBody,
  type CollegePostingView,
  type MyCandidacyView,
  type postingDecisionBody,
} from '@campuslink/shared';
import {
  BillableEventModel,
  PostingModel,
  PostingOfferModel,
  type PostingOfferDoc,
} from './employer.model.js';
import { billable } from './employers.service.js';
import { NetworkCandidacyModel, NetworkProfileModel } from '../network/network.model.js';
import { notEnabled } from '../network/network.service.js';
import { TenantModel } from '../tenants/tenant.model.js';
import { findTenantById, invalidateTenant, type TenantRecord } from '../tenants/tenant.cache.js';
import { networkScope, type NetworkActor } from '../../lib/network-scope.js';
import { requireTenantId } from '../../lib/context.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { PlacementsService } from '../placements/placements.service.js';
import type { OffersService } from '../placements/offers.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { AuthState } from '../../types.js';
import { noTrack, type Track } from '../../lib/product-events.js';

const DAY = 24 * 3600_000;

export interface CollegePostingsDeps {
  placements: Pick<PlacementsService, 'create' | 'registrationsOn' | 'driveTitle'>;
  offers: Pick<OffersService, 'verifiedOnDrive'>;
  profiles: Pick<ProfilesService, 'networkFacts'>;
  pricing?: () => typeof EMPLOYER_PRICING_DEFAULT;
}

/**
 * The college's side of the recruiter portal (prompt 2, G12, ADR 0014 §10, §11): postings offered
 * to it, its decisions (an approval becomes a drive), blocks, reports, and its students' candidacies.
 */
export class CollegePostingsService {
  track: Track = noTrack;
  constructor(private readonly d: CollegePostingsDeps) {}

  private pricing() {
    return this.d.pricing?.() ?? EMPLOYER_PRICING_DEFAULT;
  }
  private async tenant(): Promise<TenantRecord> {
    const t = await findTenantById(requireTenantId());
    if (!t) throw notFound('College');
    return t;
  }
  private actor(viewer: AuthState, meta?: RequestMetaLite): NetworkActor {
    return {
      tenantId: String(requireTenantId()),
      kind: 'college',
      userId: viewer.userId,
      ...(meta ? { meta } : {}),
    };
  }

  private view(o: PostingOfferDoc): CollegePostingView {
    return {
      id: String(o._id),
      employer: { id: String(o.employerTenantId), name: o.employerName },
      title: o.title,
      role: o.role,
      type: o.type as CollegePostingView['type'],
      location: o.location,
      ctcRange: o.ctcRange ?? '',
      description: o.description,
      branches: o.branches as CollegePostingView['branches'],
      gradYears: o.gradYears,
      closesAt: o.closesAt.toISOString(),
      decision: (o.hiddenAt ? 'hidden' : o.decision) as CollegePostingView['decision'],
      declineReason: (o.declineReason ?? null) as CollegePostingView['declineReason'],
      driveId: o.driveId ? String(o.driveId) : null,
      reports: o.reportedBy?.length ?? 0,
      offeredAt: o.offeredAt.toISOString(),
    };
  }

  async adminPostings(): Promise<CollegePostingView[]> {
    const rows = await PostingOfferModel.find({}).sort({ _id: -1 }).limit(200).lean<PostingOfferDoc[]>();
    return rows.map((r) => this.view(r));
  }

  async blocked(): Promise<{ id: string; name: string }[]> {
    const t = await this.tenant();
    const ids = (t.network?.blockedEmployers ?? []).map((b) => b.employerId);
    if (!ids.length) return [];
    const rows = await TenantModel.find({ _id: { $in: ids }, kind: 'employer' })
      .select('_id branding.displayName')
      .lean<{ _id: Types.ObjectId; branding: { displayName: string } }[]>();
    return rows.map((r) => ({ id: String(r._id), name: r.branding.displayName }));
  }

  /** N31: approval creates the college's drive (B7); P9 tells the employer; billing records it. */
  async decide(
    actor: AuthState,
    id: string,
    body: z.output<typeof postingDecisionBody>,
    meta: RequestMetaLite,
  ) {
    const t = await this.tenant();
    if (t.network?.employerAccess !== true) throw notEnabled('Turn on employer access first');
    const o = await PostingOfferModel.findById(id).lean<PostingOfferDoc>();
    if (!o) throw notFound('Posting');
    if (o.decision !== 'pending') throw conflict('This posting was already decided');
    let driveId: string | null = null;
    if (body.decision === 'approved') {
      if (Date.parse(body.registrationCloseAt) > Date.parse(body.driveDate))
        throw badRequest('Registration closes before the drive');
      const drive = await this.d.placements.create(
        actor,
        driveBody.parse({
          companyName: o.employerName,
          title: o.title,
          description: `${o.description}${o.ctcRange ? `\n\nCTC: ${o.ctcRange}` : ''}`.slice(0, 4000),
          roles: [
            {
              title: o.role,
              location: o.location,
              type: o.type === 'internship' ? 'internship' : 'full_time',
            },
          ],
          mode: 'off_campus',
          driveDate: body.driveDate,
          registrationCloseAt: body.registrationCloseAt,
          eligibility: { branches: o.branches, gradYears: o.gradYears },
          resumeRequired: true,
        }),
        meta,
      );
      driveId = drive.id;
    }
    const r = await PostingOfferModel.updateOne(
      { _id: o._id, decision: 'pending' },
      {
        $set: {
          decision: body.decision,
          declineReason: body.decision === 'declined' ? body.reason : null,
          decidedBy: new Types.ObjectId(actor.userId),
          decidedAt: new Date(),
          ...(driveId ? { driveId: new Types.ObjectId(driveId) } : {}),
        },
      },
    );
    if (!r.modifiedCount) throw conflict('This posting was already decided');
    const college = new Types.ObjectId(String(t._id));
    const pricing = this.pricing();
    await networkScope(
      'network:posting-decision',
      this.actor(actor, meta),
      async () => {
        await PostingModel.updateOne(
          { tenantId: o.employerTenantId, ref: o.postingRef, 'colleges.tenantId': college },
          {
            $set: {
              'colleges.$.decision': body.decision,
              'colleges.$.declineReason': body.decision === 'declined' ? body.reason : null,
              'colleges.$.decidedAt': new Date(),
            },
          },
        );
        if (body.decision === 'approved') {
          const p = billable(
            'posting',
            `posting:${o.postingRef}`,
            o.postingRef,
            null,
            o.employerTenantId as unknown as Types.ObjectId,
            pricing,
          );
          await BillableEventModel.updateOne(p.filter, p.update, { upsert: true });
          const d = billable(
            'drive',
            `drive:${String(college)}:${o.postingRef}`,
            o.postingRef,
            college,
            o.employerTenantId as unknown as Types.ObjectId,
            pricing,
          );
          await BillableEventModel.updateOne(d.filter, d.update, { upsert: true });
        }
      },
      () => [{ tenantId: String(o.employerTenantId), count: 1 }],
    );
    await audit.record(
      {
        action: `network.posting_${body.decision}`,
        actorId: actor.userId,
        targetType: 'posting_offer',
        targetId: id,
      },
      meta,
    );
    if (body.decision === 'approved') await this.track(actor.userId, 'posting_approved', { postingId: id });
    return this.view((await PostingOfferModel.findById(id).lean<PostingOfferDoc>()) as PostingOfferDoc);
  }

  /** N27: the employer sees nothing of this college from the next request; three blocks suspend it. */
  async block(actor: AuthState, employerId: string, meta: RequestMetaLite) {
    const t = await this.tenant();
    const e = await TenantModel.findOne({ _id: employerId, kind: 'employer' }).select('_id slug').lean();
    if (!e) throw notFound('Employer');
    await TenantModel.updateOne(
      { _id: t._id, 'network.blockedEmployers.employerId': { $ne: e._id } },
      { $push: { 'network.blockedEmployers': { employerId: e._id, at: new Date() } } },
    );
    invalidateTenant(t.slug);
    await PostingOfferModel.updateMany(
      { employerTenantId: e._id, decision: 'pending' },
      { $set: { decision: 'withdrawn' } },
    );
    await NetworkCandidacyModel.updateMany(
      { employerTenantId: e._id, stage: { $ne: 'withdrawn' } },
      { $set: { stage: 'withdrawn', withdrawnAt: new Date() } },
    );
    const since = new Date(Date.now() - EMPLOYER_LIMITS.blockWindowDays * DAY);
    const blocks = await TenantModel.countDocuments({
      kind: 'college',
      'network.blockedEmployers': { $elemMatch: { employerId: e._id, at: { $gte: since } } },
    });
    if (blocks >= EMPLOYER_LIMITS.blocksToSuspend) {
      await TenantModel.updateOne(
        { _id: e._id, 'employer.status': 'approved' },
        {
          $set: {
            'employer.status': 'suspended',
            'employer.suspendedAt': new Date(),
            'employer.reviewNote': 'Blocked by three colleges',
          },
        },
      );
      invalidateTenant(e.slug);
    }
    await audit.record(
      {
        action: 'network.employer_blocked',
        actorId: actor.userId,
        targetType: 'tenant',
        targetId: employerId,
      },
      meta,
    );
    return this.blocked();
  }

  async unblock(actor: AuthState, employerId: string, meta: RequestMetaLite) {
    const t = await this.tenant();
    await TenantModel.updateOne(
      { _id: t._id },
      { $pull: { 'network.blockedEmployers': { employerId: new Types.ObjectId(employerId) } } },
    );
    invalidateTenant(t.slug);
    await audit.record(
      {
        action: 'network.employer_unblocked',
        actorId: actor.userId,
        targetType: 'tenant',
        targetId: employerId,
      },
      meta,
    );
    return this.blocked();
  }

  /** N28: three reports from different members hide a posting until a moderator decides. */
  async report(viewer: AuthState, id: string) {
    const o = await PostingOfferModel.findOneAndUpdate(
      { _id: id, decision: 'approved' },
      { $addToSet: { reportedBy: new Types.ObjectId(viewer.userId) } },
      { returnDocument: 'after' },
    ).lean<PostingOfferDoc>();
    if (!o) throw notFound('Posting');
    if (!o.hiddenAt && (o.reportedBy?.length ?? 0) >= EMPLOYER_LIMITS.reportsToHide)
      await PostingOfferModel.updateOne({ _id: o._id }, { $set: { hiddenAt: new Date() } });
    return { reported: true };
  }

  /** A moderator's decision on a hidden posting: shown again, or declined. */
  async moderate(actor: AuthState, id: string, keep: boolean, meta: RequestMetaLite) {
    const r = await PostingOfferModel.updateOne(
      { _id: id, hiddenAt: { $ne: null } },
      keep
        ? { $set: { hiddenAt: null, reportedBy: [] } }
        : { $set: { decision: 'declined', declineReason: 'other' } },
    );
    if (!r.matchedCount) throw notFound('Hidden posting');
    await audit.record(
      {
        action: keep ? 'network.posting_kept' : 'network.posting_removed',
        actorId: actor.userId,
        targetId: id,
      },
      meta,
    );
    return this.adminPostings();
  }

  // ── Students' candidacies ─────────────────────────────

  /** Employer drives the student registered for, and whether they shared with the employer. */
  async mine(viewer: AuthState): Promise<{ eligible: MyCandidacyView[]; shared: MyCandidacyView[] }> {
    const offers = await PostingOfferModel.find({
      decision: 'approved',
      driveId: { $ne: null },
      hiddenAt: null,
    })
      .sort({ _id: -1 })
      .limit(100)
      .lean<PostingOfferDoc[]>();
    const mineRows = await NetworkCandidacyModel.find({ userId: new Types.ObjectId(viewer.userId) })
      .sort({ _id: -1 })
      .lean();
    const byPosting = new Map(mineRows.map((c) => [`${String(c.employerTenantId)}:${c.postingRef}`, c]));
    const eligible: MyCandidacyView[] = [];
    for (const o of offers) {
      const key = `${String(o.employerTenantId)}:${o.postingRef}`;
      if (byPosting.has(key) && byPosting.get(key)?.stage !== 'withdrawn') continue;
      const reg = (await this.d.placements.registrationsOn(String(o.driveId), [viewer.userId])).get(
        viewer.userId,
      );
      if (!reg || reg.withdrawn) continue;
      eligible.push({
        ref: '',
        employer: o.employerName,
        driveId: String(o.driveId),
        title: o.title,
        stage: 'shared',
        sharedAt: '',
      });
    }
    const names = new Map(offers.map((o) => [`${String(o.employerTenantId)}:${o.postingRef}`, o]));
    const shared = mineRows.map((c) => {
      const o = names.get(`${String(c.employerTenantId)}:${c.postingRef}`);
      return {
        ref: c.ref,
        employer: o?.employerName ?? '',
        driveId: String(c.driveId),
        title: o?.title ?? '',
        stage: c.stage as MyCandidacyView['stage'],
        sharedAt: c.sharedAt.toISOString(),
      };
    });
    return { eligible, shared };
  }

  async share(viewer: AuthState, driveId: string, meta: RequestMetaLite) {
    const t = await this.tenant();
    if (t.network?.employerAccess !== true)
      throw notEnabled('Your college has not turned on employer access');
    const profile = await NetworkProfileModel.findOne({
      userId: new Types.ObjectId(viewer.userId),
      employerVisible: true,
    })
      .select('_id')
      .lean();
    if (!profile) throw notEnabled('Turn on “Employers my college approved can see what I share” first');
    const o = await PostingOfferModel.findOne({
      driveId: new Types.ObjectId(driveId),
      decision: 'approved',
      hiddenAt: null,
    }).lean<PostingOfferDoc>();
    if (!o) throw notFound('Employer drive');
    if ((t.network?.blockedEmployers ?? []).some((b) => String(b.employerId) === String(o.employerTenantId)))
      throw notFound('Employer drive');
    const reg = (await this.d.placements.registrationsOn(driveId, [viewer.userId])).get(viewer.userId);
    if (!reg || reg.withdrawn) throw badRequest('Register for the drive first (with your résumé)');
    const f = (await this.d.profiles.networkFacts([viewer.userId])).get(viewer.userId);
    if (!f) throw notFound('Profile');
    const set = {
      driveId: new Types.ObjectId(driveId),
      employerTenantId: o.employerTenantId,
      name: f.name,
      branch: f.branch,
      gradYear: f.gradYear,
      resumeFileId: reg.resumeFileId ? new Types.ObjectId(reg.resumeFileId) : null,
      stage: 'shared',
      sharedAt: new Date(),
      withdrawnAt: null,
    };
    await NetworkCandidacyModel.updateOne(
      { postingRef: o.postingRef, userId: new Types.ObjectId(viewer.userId) },
      // A new ref when sharing again after a withdrawal: the employer cannot link the two.
      {
        $set: { ...set, ref: randomToken(16) },
        $setOnInsert: { postingRef: o.postingRef, userId: new Types.ObjectId(viewer.userId) },
      },
      { upsert: true },
    );
    await audit.record(
      { action: 'network.candidacy_shared', actorId: viewer.userId, targetType: 'drive', targetId: driveId },
      meta,
    );
    await this.track(viewer.userId, 'candidacy_shared', { driveId });
    return this.mine(viewer);
  }

  async withdraw(viewer: AuthState, ref: string, meta: RequestMetaLite) {
    const r = await NetworkCandidacyModel.updateOne(
      { ref, userId: new Types.ObjectId(viewer.userId), stage: { $ne: 'withdrawn' } },
      { $set: { stage: 'withdrawn', withdrawnAt: new Date() } },
    );
    if (!r.matchedCount) throw notFound('Shared application');
    await audit.record(
      {
        action: 'network.candidacy_withdrawn',
        actorId: viewer.userId,
        targetType: 'network_candidacy',
        targetId: ref,
      },
      meta,
    );
    return this.mine(viewer);
  }

  /** NetworkService.refresh: withdrawing `employer_visibility` (or leaving) withdraws every candidacy (N17). */
  async onMemberRefresh(userId: string, state: { employerVisible: boolean }) {
    if (state.employerVisible) return;
    await NetworkCandidacyModel.updateMany(
      { userId: new Types.ObjectId(userId), stage: { $ne: 'withdrawn' } },
      { $set: { stage: 'withdrawn', withdrawnAt: new Date() } },
    );
  }

  /**
   * The reconcile's half for candidacies (N19): blocks and switches, withdrawn registrations, the
   * results the college published, and hires (P15) for verified offers on posting drives.
   */
  async reconcile(): Promise<{ withdrawn: number; hires: number }> {
    const t = await this.tenant();
    if (t.kind !== 'college') return { withdrawn: 0, hires: 0 };
    let withdrawn = 0;
    const now = new Date();
    if (t.network?.employerAccess !== true) {
      const r = await NetworkCandidacyModel.updateMany(
        { stage: { $ne: 'withdrawn' } },
        { $set: { stage: 'withdrawn', withdrawnAt: now } },
      );
      withdrawn += r.modifiedCount;
    }
    const blocked = (t.network?.blockedEmployers ?? []).map((b) => b.employerId);
    if (blocked.length) {
      const r = await NetworkCandidacyModel.updateMany(
        { employerTenantId: { $in: blocked }, stage: { $ne: 'withdrawn' } },
        { $set: { stage: 'withdrawn', withdrawnAt: now } },
      );
      withdrawn += r.modifiedCount;
    }
    const live = await NetworkCandidacyModel.find({ stage: { $ne: 'withdrawn' } })
      .select('ref userId driveId stage')
      .lean();
    const visible = new Set(
      (
        await NetworkProfileModel.find({ employerVisible: true, userId: { $in: live.map((c) => c.userId) } })
          .select('userId')
          .lean()
      ).map((p) => String(p.userId)),
    );
    const byDrive = new Map<string, typeof live>();
    for (const c of live) byDrive.set(String(c.driveId), [...(byDrive.get(String(c.driveId)) ?? []), c]);
    for (const [driveId, rows] of byDrive) {
      const regs = await this.d.placements.registrationsOn(
        driveId,
        rows.map((r) => String(r.userId)),
      );
      for (const c of rows) {
        const reg = regs.get(String(c.userId));
        let next: string | null = null;
        if (!visible.has(String(c.userId)) || !reg || reg.withdrawn) next = 'withdrawn';
        else if (reg.final === 'selected' && c.stage !== 'selected') next = 'selected';
        else if (reg.final === 'not_selected' && c.stage !== 'not_selected') next = 'not_selected';
        if (!next) continue;
        await NetworkCandidacyModel.updateOne(
          { _id: c._id },
          { $set: { stage: next, ...(next === 'withdrawn' ? { withdrawnAt: now } : {}) } },
        );
        if (next === 'withdrawn') withdrawn++;
      }
    }
    // Hires: a verified offer on a drive that came from a posting, billed once per offer.
    let hires = 0;
    const drives = await PostingOfferModel.find({ decision: 'approved', driveId: { $ne: null } })
      .select('driveId employerTenantId postingRef')
      .lean();
    const pricing = this.pricing();
    for (const o of drives) {
      const offers = await this.d.offers.verifiedOnDrive(String(o.driveId));
      if (!offers.length) continue;
      const college = new Types.ObjectId(String(t._id));
      const n = await networkScope(
        'network:hire-billing',
        { tenantId: String(t._id), kind: 'job', userId: null },
        async () => {
          let created = 0;
          for (const offerId of offers) {
            const key = `hire:${String(college)}:${offerKey(offerId, o.postingRef)}`;
            const b = billable(
              'hire',
              key,
              o.postingRef,
              college,
              o.employerTenantId as unknown as Types.ObjectId,
              pricing,
            );
            const r = await BillableEventModel.updateOne(b.filter, b.update, { upsert: true });
            created += r.upsertedCount;
          }
          return created;
        },
        (c) => (c ? [{ tenantId: String(o.employerTenantId), count: c }] : []),
      );
      hires += n;
    }
    return { withdrawn, hires };
  }

  // ── Privacy ─────────────────────────────

  async exportFor(userId: string) {
    return {
      candidacies: await NetworkCandidacyModel.find({ userId: new Types.ObjectId(userId) })
        .select('ref postingRef driveId stage sharedAt withdrawnAt')
        .lean(),
    };
  }
  async eraseFor(userId: string) {
    await NetworkCandidacyModel.deleteMany({ userId: new Types.ObjectId(userId) });
  }
}

/** A stable, non-reversible key per offer (the employer's billing never holds a college's ids). */
const offerKey = (offerId: string, postingRef: string): string =>
  sha256(`${postingRef}:${offerId}`).slice(0, 22);
