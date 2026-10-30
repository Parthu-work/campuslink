import { Types } from 'mongoose';
import type { z } from 'zod';
import writeXlsxFile from 'write-excel-file/node';
import { fileTypeFromBuffer } from 'file-type';
import {
  DRIVE_CLOSING_SOON_HOURS,
  DRIVE_REMINDER_HOURS,
  ErrorCode,
  checkEligibility,
  type DriveRoleType,
  type DriveStatus,
  type DriveView,
  type EligibilityCriteria,
  type ExportColumn,
  type MyRegistrationView,
  type PlacementCompanyView,
  type RegistrantView,
  type RoundImportResult,
  type RoundResult,
  type driveBody,
  type driveUpdateBody,
  type finalBody,
  type registerBody,
} from '@campuslink/shared';
import {
  DriveRegistrationModel,
  PlacementCompanyModel,
  PlacementDriveModel,
  type DriveDoc,
  type PlacementCompanyDoc,
  type RegistrationDoc,
} from './placements.model.js';
import type { AcademicsService } from './academics.service.js';
import type { OffersService } from './offers.service.js';
import type { WhitelistService } from '../imports/whitelist.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { FilesService } from '../files/files.service.js';
import type { EventsService } from '../events/events.service.js';
import { csvCell } from '../imports/imports.service.js';
import { csvAdapter } from '../imports/adapters/csv.js';
import { xlsxAdapter } from '../imports/adapters/xlsx.js';
import { SourceError } from '../imports/adapters/types.js';
import { companyKey } from '../../lib/company.js';
import { requireTenantId } from '../../lib/context.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { AuthState } from '../../types.js';

export const DRIVE_OPEN_JOB = 'placements.open';
export const DRIVE_REMINDER_JOB = 'placements.reminder';
const HOUR = 3600_000;
const PAGE = 30;
const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;

/** Status changes the placement cell may make, from each status. */
const NEXT: Record<DriveStatus, readonly DriveStatus[]> = {
  draft: ['open', 'cancelled'],
  open: ['closed', 'in_progress', 'cancelled'],
  closed: ['open', 'in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};
/** What students may see: drafts never, cancelled ones only if they had registered. */
const VISIBLE: readonly DriveStatus[] = ['open', 'closed', 'in_progress', 'completed'];

const ROLL_HEADERS = [
  'roll',
  'roll no',
  'roll number',
  'rollno',
  'roll_no',
  'hall ticket',
  'htno',
  'reg no',
  'pin',
];
const RESULT_HEADERS = ['result', 'status', 'outcome', 'round result', 'decision'];
/** Result words a company sheet uses, mapped to ours (anything else is reported, never guessed). */
const RESULT_WORDS: [RegExp, RoundResult][] = [
  [/^(cleared|clear|pass|passed|qualified|selected|shortlisted|yes|y)$/i, 'cleared'],
  [/^(not[ _-]?cleared|fail|failed|rejected|not[ _-]?qualified|not[ _-]?selected|no|n)$/i, 'not_cleared'],
  [/^(absent|ab|did not attend|no[ _-]?show)$/i, 'absent'],
  [/^(pending|awaited|on[ _-]?hold)$/i, 'pending'],
];

export interface PlacementsDeps {
  whitelist: WhitelistService;
  academics: AcademicsService;
  offers: OffersService;
  profiles: ProfilesService;
  notifications: NotificationsService;
  files: FilesService;
  jobs: JobQueue;
  events?: EventsService;
}

type Criteria = EligibilityCriteria;
const criteriaOf = (d: DriveDoc): Criteria => ({
  branches: d.eligibility?.branches ?? [],
  gradYears: d.eligibility?.gradYears ?? [],
  minCgpa: d.eligibility?.minCgpa ?? null,
  maxActiveBacklogs: d.eligibility?.maxActiveBacklogs ?? null,
  maxHistoryBacklogs: d.eligibility?.maxHistoryBacklogs ?? null,
  minTenthPct: d.eligibility?.minTenthPct ?? null,
  minTwelfthPct: d.eligibility?.minTwelfthPct ?? null,
});
const registrationOpen = (d: DriveDoc) => d.status === 'open' && d.registrationCloseAt > new Date();

/**
 * Placement drives (B7, docs/specs/placements.md): companies, drives with eligibility rules,
 * one-tap registration, overrides, exports for the company, round results and selections.
 */
export class PlacementsService {
  constructor(private readonly d: PlacementsDeps) {}

  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    return DriveRegistrationModel.find({ userId: new Types.ObjectId(userId) })
      .select('driveId answers status roundResults final createdAt')
      .lean();
  }

  /** Erasure anonymises registrations (branch and batch stay); answers and the résumé go. */
  async eraseFor(userId: string) {
    const u = new Types.ObjectId(userId);
    const rows = await DriveRegistrationModel.find({ userId: u }).select('resumeFileId').lean();
    for (const r of rows) if (r.resumeFileId) await this.d.files.remove(r.resumeFileId);
    await DriveRegistrationModel.updateMany(
      { userId: u },
      { $set: { userId: null, answers: [], resumeFileId: null } },
    );
    await PlacementDriveModel.updateMany({ 'overrides.userId': u }, { $pull: { overrides: { userId: u } } });
  }

  // ── Companies ─────────────────────────────
  private companyView(c: PlacementCompanyDoc | null, staff: boolean): PlacementCompanyView {
    return {
      id: c ? String(c._id) : '',
      name: c?.name ?? '',
      website: c?.website ?? null,
      sector: c?.sector ?? '',
      ...(staff ? { notes: c?.notes ?? '' } : {}),
    };
  }

  async companies() {
    const rows = await PlacementCompanyModel.find()
      .sort({ name: 1 })
      .limit(500)
      .lean<PlacementCompanyDoc[]>();
    return rows.map((c) => this.companyView(c, true));
  }

  async upsertCompany(body: { name: string; website: string | null; sector: string; notes: string }) {
    const key = companyKey(body.name);
    if (!key) throw badRequest('Give the company a name');
    const c = await PlacementCompanyModel.findOneAndUpdate(
      { companyKey: key },
      { $set: { ...body, companyKey: key } },
      { upsert: true, returnDocument: 'after' },
    ).lean<PlacementCompanyDoc>();
    return this.companyView(c, true);
  }

  private async companyFor(body: { companyId?: string | undefined; companyName?: string | undefined }) {
    if (body.companyId) {
      const c = await PlacementCompanyModel.findById(body.companyId).lean();
      if (!c) throw notFound('Company');
      return c._id;
    }
    const key = companyKey(body.companyName ?? '');
    if (!key) throw badRequest('Name the company');
    const c = await PlacementCompanyModel.findOneAndUpdate(
      { companyKey: key },
      { $setOnInsert: { name: body.companyName, companyKey: key } },
      { upsert: true, returnDocument: 'after' },
    ).lean();
    return (c as PlacementCompanyDoc)._id;
  }

  // ── Views ─────────────────────────────
  private async load(id: string): Promise<DriveDoc> {
    const d = await PlacementDriveModel.findById(id).lean<DriveDoc>();
    if (!d) throw notFound('Drive');
    return d;
  }

  /**
   * Eligibility of members, from their profile and (verified) academic record: read once, then
   * checked against any number of drives.
   */
  private async eligibilityOf(userIds: string[]) {
    const [cohort, facts] = await Promise.all([
      this.d.profiles.cohortOf(userIds),
      this.d.academics.factsFor(userIds),
    ]);
    return (drive: DriveDoc, u: string) => {
      const c = cohort.get(u);
      return checkEligibility(criteriaOf(drive), facts.get(u) ?? null, {
        branch: c?.branch ?? null,
        gradYear: c?.gradYear ?? null,
      });
    };
  }

  private async views(viewer: AuthState, drives: DriveDoc[]): Promise<DriveView[]> {
    const staff = viewer.permissions.has('placements:manage');
    const companies = new Map(
      (
        await PlacementCompanyModel.find({ _id: { $in: drives.map((d) => d.companyId) } }).lean<
          PlacementCompanyDoc[]
        >()
      ).map((c) => [String(c._id), c]),
    );
    const mine = new Map(
      (
        await DriveRegistrationModel.find({
          driveId: { $in: drives.map((d) => d._id) },
          userId: new Types.ObjectId(viewer.userId),
        }).lean<RegistrationDoc[]>()
      ).map((r) => [String(r.driveId), r]),
    );
    const counts = staff
      ? new Map(
          (
            await DriveRegistrationModel.aggregate<{ _id: Types.ObjectId; n: number }>([
              {
                $match: {
                  driveId: { $in: drives.map((d) => d._id) },
                  status: { $in: ['registered', 'tpo_override'] },
                },
              },
              { $group: { _id: '$driveId', n: { $sum: 1 } } },
            ])
          ).map((r) => [String(r._id), r.n]),
        )
      : new Map<string, number>();
    const check = await this.eligibilityOf([viewer.userId]);
    const out: DriveView[] = [];
    for (const d of drives) {
      const elig = check(d, viewer.userId);
      const reg = mine.get(String(d._id));
      out.push({
        id: String(d._id),
        company: this.companyView(companies.get(String(d.companyId)) ?? null, staff),
        title: d.title,
        description: d.description,
        roles: d.roles.map((r) => ({
          title: r.title,
          ctcMinLpa: r.ctcMinLpa ?? null,
          ctcMaxLpa: r.ctcMaxLpa ?? null,
          location: r.location ?? '',
          type: r.type as DriveRoleType,
        })),
        mode: d.mode as DriveView['mode'],
        venue: d.venue,
        driveDate: d.driveDate.toISOString(),
        registrationCloseAt: d.registrationCloseAt.toISOString(),
        eligibility: criteriaOf(d) as DriveView['eligibility'],
        questions: d.questions.map((q) => ({
          label: q.label,
          kind: q.kind as DriveView['questions'][number]['kind'],
          options: q.options,
          required: q.required,
        })),
        rounds: d.rounds.map((r) => ({
          name: r.name,
          kind: r.kind as DriveView['rounds'][number]['kind'],
          at: r.at ? r.at.toISOString() : null,
        })),
        resumeRequired: d.resumeRequired,
        status: d.status as DriveStatus,
        linkedEventId: d.linkedEventId ? String(d.linkedEventId) : null,
        registrationOpen: registrationOpen(d),
        eligible: elig.eligible,
        reasons: elig.reasons,
        overridden: d.overrides.some((o) => String(o.userId) === viewer.userId),
        myRegistration: reg ? this.myView(reg) : null,
        ...(staff ? { registrations: counts.get(String(d._id)) ?? 0 } : {}),
      });
    }
    return out;
  }

  private myView(r: RegistrationDoc): MyRegistrationView {
    return {
      id: String(r._id),
      status: r.status as MyRegistrationView['status'],
      final: r.final as MyRegistrationView['final'],
      roundResults: r.roundResults.map((x) => ({ round: x.round ?? 0, result: x.result as RoundResult })),
      createdAt: r.createdAt.toISOString(),
    };
  }

  // ── Students ─────────────────────────────
  /** Drives a student may see: eligible and open ones, every visible one, or the ones they registered for. */
  async list(viewer: AuthState, scope: 'eligible' | 'all' | 'registered') {
    let drives: DriveDoc[];
    if (scope === 'registered') {
      const regs = await DriveRegistrationModel.find({ userId: new Types.ObjectId(viewer.userId) })
        .select('driveId')
        .sort({ _id: -1 })
        .limit(100)
        .lean();
      drives = await PlacementDriveModel.find({ _id: { $in: regs.map((r) => r.driveId) } })
        .sort({ driveDate: -1 })
        .lean<DriveDoc[]>();
    } else {
      drives = await PlacementDriveModel.find({
        status: scope === 'eligible' ? 'open' : { $in: VISIBLE },
        ...(scope === 'eligible' ? { registrationCloseAt: { $gt: new Date() } } : {}),
      })
        .sort({ registrationCloseAt: scope === 'eligible' ? 1 : -1 })
        .limit(100)
        .lean<DriveDoc[]>();
    }
    const views = await this.views(viewer, drives);
    return scope === 'eligible' ? views.filter((v) => v.eligible || v.overridden) : views;
  }

  async get(viewer: AuthState, id: string): Promise<DriveView> {
    const d = await this.load(id);
    const staff = viewer.permissions.has('placements:manage');
    if (!staff && !VISIBLE.includes(d.status as DriveStatus)) {
      const registered = await DriveRegistrationModel.exists({
        driveId: d._id,
        userId: new Types.ObjectId(viewer.userId),
      });
      if (!registered) throw notFound('Drive');
    }
    return (await this.views(viewer, [d]))[0] as DriveView;
  }

  /**
   * One-tap registration: open drive, eligible (or let in by the placement cell), required answers
   * and résumé present. Files are validated before any is claimed; the unique index ends races.
   */
  async register(viewer: AuthState, id: string, body: z.output<typeof registerBody>, meta: RequestMetaLite) {
    const d = await this.load(id);
    if (!registrationOpen(d)) throw conflict('Registration for this drive is closed');
    const overridden = d.overrides.some((o) => String(o.userId) === viewer.userId);
    const elig = (await this.eligibilityOf([viewer.userId]))(d, viewer.userId);
    if (!elig.eligible && !overridden)
      throw new AppError(403, ErrorCode.FORBIDDEN, 'You are not eligible for this drive', elig.reasons);
    const answers = new Map(body.answers.map((a) => [a.question, a.value.trim()]));
    const files: string[] = [];
    d.questions.forEach((q, i) => {
      const v = answers.get(i) ?? '';
      if (q.required && !v) throw badRequest(`Answer “${q.label}”`);
      if (v && q.kind === 'choice' && !q.options.includes(v))
        throw badRequest(`Pick one of the options for “${q.label}”`);
      if (v && q.kind === 'file') files.push(v);
    });
    for (const a of answers.keys())
      if (a >= d.questions.length) throw badRequest('Answer only the drive’s questions');
    if (d.resumeRequired && !body.resumeFileId) throw badRequest('Attach your résumé (PDF)');
    if (body.resumeFileId) files.push(body.resumeFileId);
    for (const f of files)
      if (!(await this.d.files.pending(f, viewer.userId, 'placement_resume')))
        throw badRequest('Upload the file again (it expired or is already used)');
    const existing = await DriveRegistrationModel.findOne({
      driveId: d._id,
      userId: new Types.ObjectId(viewer.userId),
    }).lean();
    if (existing && existing.status !== 'withdrawn')
      throw conflict('You are already registered for this drive');
    const cohort = (await this.d.profiles.cohortOf([viewer.userId])).get(viewer.userId);
    const fields = {
      answers: [...answers].map(([question, value]) => ({ question, value })),
      resumeFileId: body.resumeFileId ? new Types.ObjectId(body.resumeFileId) : null,
      status: elig.eligible ? 'registered' : 'tpo_override',
      final: 'in_process',
      roundResults: [],
      branch: cohort?.branch ?? null,
      gradYear: cohort?.gradYear ?? null,
    };
    let reg: RegistrationDoc;
    try {
      reg = existing
        ? ((await DriveRegistrationModel.findOneAndUpdate(
            { _id: existing._id, status: 'withdrawn' },
            { $set: fields },
            { returnDocument: 'after' },
          ).lean<RegistrationDoc>()) as RegistrationDoc)
        : ((
            await DriveRegistrationModel.create({
              driveId: d._id,
              userId: new Types.ObjectId(viewer.userId),
              ...fields,
            })
          ).toObject() as RegistrationDoc);
      if (!reg) throw conflict('You are already registered for this drive');
    } catch (e) {
      if (isDuplicate(e)) throw conflict('You are already registered for this drive');
      throw e;
    }
    for (const f of files) await this.d.files.claim(f, viewer.userId, 'placement_resume', null);
    await audit.record(
      {
        action: 'placements.registered',
        actorId: viewer.userId,
        targetType: 'drive',
        targetId: id,
        meta: { override: !elig.eligible },
      },
      meta,
    );
    return this.myView(reg);
  }

  async withdraw(viewer: AuthState, id: string) {
    const d = await this.load(id);
    if (!['open', 'closed'].includes(d.status))
      throw conflict('The drive has started; ask the placement cell');
    const reg = await DriveRegistrationModel.findOneAndUpdate(
      { driveId: d._id, userId: new Types.ObjectId(viewer.userId), status: { $ne: 'withdrawn' } },
      { $set: { status: 'withdrawn', final: 'withdrawn' } },
      { returnDocument: 'after' },
    ).lean<RegistrationDoc>();
    if (!reg) throw notFound('Registration');
    return this.myView(reg);
  }

  /** Files hook: a registration's résumé is readable by the placement cell. */
  async resumeAccess(fileId: string, viewer: AuthState) {
    if (!viewer.permissions.has('placements:manage')) return null;
    const id = new Types.ObjectId(fileId);
    const reg = await DriveRegistrationModel.exists({
      $or: [{ resumeFileId: id }, { 'answers.value': fileId }],
    });
    return reg ? { name: 'resume.pdf' } : null;
  }

  // ── Placement cell ─────────────────────────────
  async adminList(viewer: AuthState, q: { status?: string | undefined; cursor?: string | undefined }) {
    const rows = await PlacementDriveModel.find({
      ...(q.status ? { status: q.status } : {}),
      ...(q.cursor ? { _id: { $lt: new Types.ObjectId(q.cursor) } } : {}),
    })
      .sort({ _id: -1 })
      .limit(PAGE + 1)
      .lean<DriveDoc[]>();
    const page = rows.slice(0, PAGE);
    return {
      items: await this.views(viewer, page),
      nextCursor: rows.length > PAGE ? String(page.at(-1)?._id) : null,
    };
  }

  private fields(body: z.output<typeof driveUpdateBody>) {
    return {
      title: body.title,
      description: body.description,
      roles: body.roles,
      mode: body.mode,
      venue: body.venue,
      driveDate: new Date(body.driveDate),
      registrationCloseAt: new Date(body.registrationCloseAt),
      eligibility: body.eligibility,
      questions: body.questions,
      rounds: body.rounds.map((r) => ({ ...r, at: r.at ? new Date(r.at) : null })),
      resumeRequired: body.resumeRequired,
    };
  }

  async create(
    actor: AuthState,
    body: z.output<typeof driveBody>,
    meta: RequestMetaLite,
  ): Promise<DriveView> {
    const companyId = await this.companyFor(body);
    const doc = await PlacementDriveModel.create({
      ...this.fields(body),
      companyId,
      createdBy: new Types.ObjectId(actor.userId),
    });
    if (body.createEvent && this.d.events) {
      const start = new Date(body.driveDate);
      const company = await PlacementCompanyModel.findById(companyId).lean();
      const event = await this.d.events.create(
        actor,
        {
          title: `${company?.name ?? ''}: ${body.title}`.slice(0, 120),
          description:
            `Placement drive. Check eligibility and register in the Placements section. ${body.description}`
              .trim()
              .slice(0, 4000),
          kind: 'drive',
          mode: 'in_person',
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 4 * HOUR).toISOString(),
          location: body.venue || 'Placement cell',
          onlineUrl: null,
          capacity: null,
          audience: 'students',
          branches: body.eligibility.branches.slice(0, 10),
        },
        meta,
      );
      await PlacementDriveModel.updateOne(
        { _id: doc._id },
        { $set: { linkedEventId: new Types.ObjectId(event.id) } },
      );
    }
    await audit.record(
      {
        action: 'placements.drive_created',
        actorId: actor.userId,
        targetType: 'drive',
        targetId: String(doc._id),
      },
      meta,
    );
    return this.get(actor, String(doc._id));
  }

  async update(actor: AuthState, id: string, body: z.output<typeof driveUpdateBody>, meta: RequestMetaLite) {
    const d = await this.load(id);
    if (!['draft', 'open', 'closed'].includes(d.status))
      throw conflict('A drive that has started cannot be edited');
    const companyId = await this.companyFor(body);
    const fields = this.fields(body);
    const moved = fields.registrationCloseAt.getTime() !== d.registrationCloseAt.getTime();
    const after = await PlacementDriveModel.findOneAndUpdate(
      { _id: d._id },
      { $set: { ...fields, companyId }, ...(moved ? { $inc: { version: 1 } } : {}) },
      { returnDocument: 'after' },
    ).lean<DriveDoc>();
    if (moved && after?.status === 'open') await this.scheduleReminder(after);
    await audit.record(
      { action: 'placements.drive_updated', actorId: actor.userId, targetType: 'drive', targetId: id },
      meta,
    );
    return this.get(actor, id);
  }

  /** Opening notifies eligible students and schedules the reminder; every change bumps the version. */
  async setStatus(actor: AuthState, id: string, status: DriveStatus, meta: RequestMetaLite) {
    const d = await this.load(id);
    if (!NEXT[d.status as DriveStatus].includes(status))
      throw conflict(`A ${d.status.replace('_', ' ')} drive cannot become ${status.replace('_', ' ')}`);
    if (status === 'open' && d.registrationCloseAt <= new Date())
      throw badRequest('Move the registration close into the future first');
    const after = await PlacementDriveModel.findOneAndUpdate(
      { _id: d._id, status: d.status },
      {
        $set: { status, ...(status === 'open' && !d.openedAt ? { openedAt: new Date() } : {}) },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    ).lean<DriveDoc>();
    if (!after) throw conflict('This drive just changed. Refresh and try again.');
    await this.d.jobs.cancel(DRIVE_REMINDER_JOB, `drvrem-${id}`);
    if (status === 'open') {
      if (!d.openedAt)
        await this.d.jobs.enqueue(DRIVE_OPEN_JOB, {
          tenantId: String(requireTenantId()),
          driveId: id,
          version: after.version,
        });
      await this.scheduleReminder(after);
    }
    await audit.record(
      {
        action: 'placements.drive_status',
        actorId: actor.userId,
        targetType: 'drive',
        targetId: id,
        meta: { from: d.status, to: status },
      },
      meta,
    );
    return this.get(actor, id);
  }

  private async scheduleReminder(d: DriveDoc) {
    await this.d.jobs.cancel(DRIVE_REMINDER_JOB, `drvrem-${String(d._id)}`);
    const at = d.registrationCloseAt.getTime() - DRIVE_REMINDER_HOURS * HOUR;
    if (at <= Date.now()) return;
    await this.d.jobs.enqueue(
      DRIVE_REMINDER_JOB,
      { tenantId: String(requireTenantId()), driveId: String(d._id), version: d.version },
      { jobId: `drvrem-${String(d._id)}`, delayMs: at - Date.now() },
    );
  }

  /** Students the drive is for: verified students in its branches and batches who meet the rules (or were let in). */
  private async eligibleStudents(d: DriveDoc): Promise<string[]> {
    const ids = await this.d.profiles.idsForAudience({
      branches: d.eligibility?.branches ?? [],
      gradYears: d.eligibility?.gradYears ?? [],
      roles: ['STUDENT'],
    });
    const check = await this.eligibilityOf(ids);
    const overrides = d.overrides.map((o) => String(o.userId));
    return [...new Set([...ids.filter((u) => check(d, u).eligible), ...overrides])];
  }

  private async companyName(d: DriveDoc) {
    return (await PlacementCompanyModel.findById(d.companyId).select('name').lean())?.name ?? '';
  }

  /** Job: tell eligible students the drive is open. */
  async onOpen(job: TenantJob) {
    const d = await PlacementDriveModel.findById(String(job.driveId)).lean<DriveDoc>();
    if (!d || d.version !== job.version || d.status !== 'open') return;
    const company = await this.companyName(d);
    for (const u of await this.eligibleStudents(d))
      await this.d.notifications.notify(u, 'drive_open', {
        company,
        driveId: String(d._id),
        start: d.registrationCloseAt.toISOString(),
      });
  }

  /** Job: a day before registration closes, remind eligible students who have not registered. */
  async onReminder(job: TenantJob) {
    const d = await PlacementDriveModel.findById(String(job.driveId)).lean<DriveDoc>();
    if (!d || d.version !== job.version || !registrationOpen(d)) return;
    const registered = new Set(
      (
        await DriveRegistrationModel.find({ driveId: d._id, status: { $ne: 'withdrawn' } })
          .select('userId')
          .lean()
      ).map((r) => String(r.userId)),
    );
    const company = await this.companyName(d);
    for (const u of await this.eligibleStudents(d))
      if (!registered.has(u))
        await this.d.notifications.notify(u, 'drive_reminder', {
          company,
          driveId: String(d._id),
          start: d.registrationCloseAt.toISOString(),
        });
  }

  async override(
    actor: AuthState,
    id: string,
    who: { userId?: string | undefined; rollNumber?: string | undefined; reason: string },
    meta: RequestMetaLite,
  ) {
    const d = await this.load(id);
    const reason = who.reason;
    const userId =
      who.userId ??
      (await this.d.whitelist.membersByRoll([who.rollNumber ?? ''])).get(
        (who.rollNumber ?? '').trim().toUpperCase(),
      );
    if (!userId) throw notFound('Student with that roll number');
    const cohort = (await this.d.profiles.cohortOf([userId])).get(userId);
    if (!cohort) throw notFound('Student');
    if (!d.overrides.some((o) => String(o.userId) === userId))
      await PlacementDriveModel.updateOne(
        { _id: d._id },
        {
          $push: {
            overrides: {
              userId: new Types.ObjectId(userId),
              by: new Types.ObjectId(actor.userId),
              reason,
              at: new Date(),
            },
          },
        },
      );
    await audit.record(
      {
        action: 'placements.override',
        actorId: actor.userId,
        targetType: 'user',
        targetId: userId,
        meta: { driveId: id, reason },
      },
      meta,
    );
    return { overridden: true };
  }

  async registrants(id: string): Promise<RegistrantView[]> {
    await this.load(id);
    const regs = await DriveRegistrationModel.find({ driveId: new Types.ObjectId(id) })
      .sort({ _id: 1 })
      .limit(5000)
      .lean<RegistrationDoc[]>();
    const ids = regs.flatMap((r) => (r.userId ? [String(r.userId)] : []));
    const [cohort, records, rolls] = await Promise.all([
      this.d.profiles.cohortOf(ids),
      this.d.academics.recordsFor(ids),
      this.d.whitelist.recordsOf(ids),
    ]);
    return regs.map((r) => {
      const u = r.userId ? String(r.userId) : '';
      return {
        id: String(r._id),
        userId: u || null,
        name: cohort.get(u)?.name ?? '',
        rollNumber: rolls.get(u)?.rollNumber ?? null,
        branch: r.branch ?? null,
        gradYear: r.gradYear ?? null,
        cgpa: records.get(u)?.cgpa ?? null,
        status: r.status as RegistrantView['status'],
        final: r.final as RegistrantView['final'],
        roundResults: r.roundResults.map((x) => ({ round: x.round ?? 0, result: x.result as RoundResult })),
        resumeFileId: r.resumeFileId ? String(r.resumeFileId) : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  /** Registrants for the company: only the columns the cell ticked, audited. */
  async export(
    actor: AuthState,
    id: string,
    columns: ExportColumn[],
    format: 'csv' | 'xlsx',
    meta: RequestMetaLite,
  ) {
    const d = await this.load(id);
    const regs = (
      await DriveRegistrationModel.find({ driveId: d._id, status: { $ne: 'withdrawn' } })
        .sort({ _id: 1 })
        .limit(5000)
        .lean<RegistrationDoc[]>()
    ).filter((r) => r.userId);
    const ids = regs.map((r) => String(r.userId));
    const [cohort, records, rolls, contacts] = await Promise.all([
      this.d.profiles.cohortOf(ids),
      this.d.academics.recordsFor(ids),
      this.d.whitelist.recordsOf(ids),
      columns.includes('email') || columns.includes('phone')
        ? this.d.whitelist.contactsOf(ids)
        : Promise.resolve(new Map()),
    ]);
    const header: Record<ExportColumn, string> = {
      rollNumber: 'Roll number',
      name: 'Name',
      branch: 'Branch',
      gradYear: 'Batch',
      email: 'Email',
      phone: 'Mobile',
      cgpa: 'CGPA',
      activeBacklogs: 'Active backlogs',
      historyBacklogs: 'Backlog history',
      tenthPct: '10th %',
      twelfthPct: '12th %',
      diplomaPct: 'Diploma %',
      answers: 'Answers',
      status: 'Registration',
      final: 'Result',
    };
    const value = (r: RegistrationDoc, c: ExportColumn): string | number => {
      const u = String(r.userId);
      const rec = records.get(u);
      switch (c) {
        case 'rollNumber':
          return rolls.get(u)?.rollNumber ?? '';
        case 'name':
          return cohort.get(u)?.name ?? '';
        case 'branch':
          return r.branch ?? '';
        case 'gradYear':
          return r.gradYear ?? '';
        case 'email':
          return contacts.get(u)?.email ?? '';
        case 'phone':
          return contacts.get(u)?.phone ?? '';
        case 'answers':
          return r.answers
            .map((a) => `${d.questions[a.question ?? 0]?.label ?? ''}: ${a.value ?? ''}`)
            .join(' | ');
        case 'status':
          return r.status;
        case 'final':
          return r.final;
        default:
          return rec?.[c] ?? '';
      }
    };
    const rows = regs.map((r) => columns.map((c) => value(r, c)));
    await audit.record(
      {
        action: 'placements.exported',
        actorId: actor.userId,
        targetType: 'drive',
        targetId: id,
        meta: { columns, format, rows: rows.length },
      },
      meta,
    );
    const name = `drive-${id}-registrants`;
    if (format === 'csv') {
      const csv = [columns.map((c) => header[c]), ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
      return { body: Buffer.from(`\uFEFF${csv}`), type: 'text/csv; charset=utf-8', name: `${name}.csv` };
    }
    const sheet = [
      columns.map((c) => ({ value: header[c], fontWeight: 'bold' as const })),
      ...rows.map((r) =>
        r.map((v) => ({
          value: typeof v === 'number' ? v : String(v),
          type: typeof v === 'number' ? Number : String,
        })),
      ),
    ];
    const body = (await writeXlsxFile(sheet as never, { buffer: true })) as Buffer;
    return {
      body,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      name: `${name}.xlsx`,
    };
  }

  /** Round results by registration; each student is told when theirs changes. */
  async setRoundResults(
    actor: AuthState,
    id: string,
    round: number,
    results: { registrationId: string; result: RoundResult }[],
    meta: RequestMetaLite,
  ) {
    const d = await this.load(id);
    const r = d.rounds[round];
    if (!r) throw badRequest('This drive has no such round');
    let updated = 0;
    let unchanged = 0;
    const company = await this.companyName(d);
    for (const x of results) {
      const reg = await DriveRegistrationModel.findOne({
        _id: x.registrationId,
        driveId: d._id,
      }).lean<RegistrationDoc>();
      if (!reg) throw notFound('Registration');
      const before = reg.roundResults.find((rr) => rr.round === round)?.result ?? 'pending';
      if (before === x.result) {
        unchanged++;
        continue;
      }
      await DriveRegistrationModel.updateOne(
        { _id: reg._id },
        {
          $set: {
            roundResults: [
              ...reg.roundResults.filter((rr) => rr.round !== round),
              { round, result: x.result },
            ],
          },
        },
      );
      updated++;
      if (reg.userId && x.result !== 'pending')
        await this.d.notifications.notify(String(reg.userId), 'drive_round_result', {
          company,
          round: r.name,
          driveId: id,
        });
    }
    await audit.record(
      {
        action: 'placements.round_results',
        actorId: actor.userId,
        targetType: 'drive',
        targetId: id,
        meta: { round, updated },
      },
      meta,
    );
    return { updated, unchanged };
  }

  /**
   * Round results from the company's sheet (CSV or Excel) keyed by roll number. Roll numbers that
   * are not registered for this drive are listed back, never matched by guesswork.
   */
  async importRoundResults(
    actor: AuthState,
    id: string,
    round: number,
    file: Express.Multer.File | undefined,
    meta: RequestMetaLite,
  ): Promise<RoundImportResult> {
    if (!file) throw badRequest('Choose a CSV or Excel file');
    const d = await this.load(id);
    if (!d.rounds[round]) throw badRequest('This drive has no such round');
    const type = await fileTypeFromBuffer(file.buffer);
    let table;
    try {
      table = type?.ext === 'xlsx' ? await xlsxAdapter.read(file.buffer) : await csvAdapter.read(file.buffer);
    } catch (e) {
      if (e instanceof SourceError) throw badRequest(e.message);
      throw e;
    }
    const norm = (h: string) => h.toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
    const rollCol = table.headers.find((h) => ROLL_HEADERS.includes(norm(h)));
    const resultCol = table.headers.find((h) => RESULT_HEADERS.includes(norm(h)));
    if (!rollCol || !resultCol) throw badRequest('The file needs a roll number column and a result column');
    const errors: { row: number; message: string }[] = [];
    const wanted: { roll: string; result: RoundResult }[] = [];
    table.rows.forEach((row, i) => {
      const roll = (row[rollCol] ?? '').trim().toUpperCase();
      const word = (row[resultCol] ?? '').trim();
      const result = RESULT_WORDS.find(([rx]) => rx.test(word))?.[1];
      if (!roll) errors.push({ row: i + 2, message: 'Missing roll number' });
      else if (!result)
        errors.push({
          row: i + 2,
          message: 'Result not recognised (use cleared, not cleared, absent or pending)',
        });
      else wanted.push({ roll, result });
    });
    const members = await this.d.whitelist.membersByRoll(wanted.map((w) => w.roll));
    const regs = new Map(
      (
        await DriveRegistrationModel.find({
          driveId: d._id,
          userId: { $in: [...members.values()].map((u) => new Types.ObjectId(u)) },
        })
          .select('userId')
          .lean()
      ).map((r) => [String(r.userId), String(r._id)]),
    );
    const unknown: string[] = [];
    const results: { registrationId: string; result: RoundResult }[] = [];
    for (const w of wanted) {
      const reg = regs.get(members.get(w.roll) ?? '');
      if (reg) results.push({ registrationId: reg, result: w.result });
      else unknown.push(w.roll);
    }
    const r = results.length
      ? await this.setRoundResults(actor, id, round, results, meta)
      : { updated: 0, unchanged: 0 };
    return { ...r, unknown, errors };
  }

  /** The final result; a selection records a verified offer and congratulates the student. */
  async setFinal(
    actor: AuthState,
    registrationId: string,
    body: z.output<typeof finalBody>,
    meta: RequestMetaLite,
  ) {
    const reg = await DriveRegistrationModel.findById(registrationId).lean<RegistrationDoc>();
    if (!reg) throw notFound('Registration');
    const d = await this.load(String(reg.driveId));
    await DriveRegistrationModel.updateOne({ _id: reg._id }, { $set: { final: body.final } });
    if (body.final === 'selected' && reg.userId) {
      const role = d.roles[0];
      const company = await this.companyName(d);
      const created = await this.d.offers.fromDrive({
        userId: String(reg.userId),
        driveId: d._id,
        companyName: company,
        role: body.role ?? role?.title ?? d.title,
        ctcLpa: body.ctcLpa ?? role?.ctcMaxLpa ?? role?.ctcMinLpa ?? 0,
        type: body.type ?? ((role?.type ?? 'full_time') as DriveRoleType),
        actorId: actor.userId,
        branch: reg.branch ?? null,
        gradYear: reg.gradYear ?? null,
      });
      if (created)
        await this.d.notifications.notify(String(reg.userId), 'drive_selected', {
          company,
          driveId: String(d._id),
        });
    }
    await audit.record(
      {
        action: 'placements.final',
        actorId: actor.userId,
        targetType: 'registration',
        targetId: registrationId,
        meta: { final: body.final },
      },
      meta,
    );
    return { final: body.final };
  }

  /** Admin overview: drives whose registration closes in the next 48 hours. */
  async closingSoon() {
    return PlacementDriveModel.countDocuments({
      status: 'open',
      registrationCloseAt: { $gt: new Date(), $lte: new Date(Date.now() + DRIVE_CLOSING_SOON_HOURS * HOUR) },
    });
  }
}
