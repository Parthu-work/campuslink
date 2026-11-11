import { Types } from 'mongoose';
import type { z } from 'zod';
import writeXlsxFile, { type SheetData } from 'write-excel-file/node';
import {
  DEFAULT_READINESS_CLOSING_DAYS,
  DEFAULT_READINESS_THRESHOLD,
  DEFAULT_READINESS_WEIGHTS,
  READINESS_BANDS,
  READINESS_COMPONENTS,
  READINESS_NUDGE_COOLDOWN_DAYS,
  SMALL_CELL,
  bandOf,
  suppress,
  type Branch,
  type Count,
  type NeedsHelpRow,
  type ReadinessBoardView,
  type ReadinessComponentId,
  type ReadinessConfigView,
  type ReadinessGroupView,
  type ReadinessNudgeResult,
  type ReadinessView,
  type ReadinessWeights,
  type readinessBoardQuery,
  type readinessConfigBody,
} from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import { forbidden } from '../../lib/errors.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { csvCell } from '../imports/imports.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { ReadinessComponent, ReadinessMember } from './component.js';
import { compose } from './score.js';
import {
  ReadinessConfigModel,
  ReadinessNudgeModel,
  type ReadinessConfigDoc,
  type ReadinessNudgeDoc,
} from './readiness.model.js';

const DAY = 86_400_000;
/** The "needs help" list shows at most this many students (most urgent first). */
const NEEDS_HELP_MAX = 500;

export interface Student extends ReadinessMember {
  name: string;
  minor: boolean;
}

export interface ReadinessDeps {
  notifications: NotificationsService;
  /** Active, verified students of the college (profiles), optionally one branch or batch. */
  students: (filter: { branch?: string | undefined; gradYear?: number | undefined }) => Promise<Student[]>;
  /** The member's branch and batch (profiles). */
  cohort: (userId: string) => Promise<{ branch: string | null; gradYear: number | null } | null>;
  /** For each member, their next eligible drive closing before `until` that they have not registered for. */
  nextClosing: (
    userIds: string[],
    until: Date,
  ) => Promise<Map<string, { driveId: string; company: string; closesAt: Date }>>;
}

interface Config {
  weights: ReadinessWeights;
  threshold: number;
  closingDays: number;
  updatedAt: Date | null;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : Math.round(((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2);
};

/**
 * Placement readiness (prompt 2, G5, docs/specs/readiness.md): one honest number per student, the
 * sum of weighted components registered here (each in `components/`, reading through its owning
 * module's service), with each component's points and next step. Scores are computed on read and
 * never stored. The score is the student's own: the board shows it only to the placement cell and
 * faculty, never to other students or employers, and never ranks a minor.
 */
export class ReadinessService {
  /** Set by the app: records product events after confirmed writes (B9). */
  track: Track = noTrack;
  private readonly components = new Map<ReadinessComponentId, ReadinessComponent>();

  constructor(private readonly d: ReadinessDeps) {}

  /** Adds a component (like privacy hooks). One per id; a component not registered is skipped. */
  register(component: ReadinessComponent) {
    if (this.components.has(component.id))
      throw new Error(`Readiness component ${component.id} registered twice`);
    this.components.set(component.id, component);
  }

  get registered(): ReadonlySet<ReadinessComponentId> {
    return new Set(this.components.keys());
  }

  // ── Configuration ─────────────────────────────

  private async config(): Promise<Config> {
    const c = await ReadinessConfigModel.findOne({ key: 'college' }).lean<ReadinessConfigDoc>();
    return {
      weights: { ...DEFAULT_READINESS_WEIGHTS, ...(c?.weights ?? {}) },
      threshold: c?.threshold ?? DEFAULT_READINESS_THRESHOLD,
      closingDays: c?.closingDays ?? DEFAULT_READINESS_CLOSING_DAYS,
      updatedAt: c?.updatedAt ?? null,
    };
  }

  async configView(): Promise<ReadinessConfigView> {
    const c = await this.config();
    return {
      weights: c.weights,
      threshold: c.threshold,
      closingDays: c.closingDays,
      available: READINESS_COMPONENTS.filter((id) => this.components.has(id)),
      updatedAt: c.updatedAt?.toISOString() ?? null,
    };
  }

  async setConfig(actor: AuthState, body: z.output<typeof readinessConfigBody>, meta: RequestMetaLite) {
    const before = await this.config();
    await ReadinessConfigModel.updateOne(
      { key: 'college' },
      { $set: { weights: body.weights, threshold: body.threshold, closingDays: body.closingDays } },
      { upsert: true },
    );
    await audit.record(
      {
        action: 'readiness.config_changed',
        actorId: actor.userId,
        targetType: 'readiness',
        meta: {
          before: READINESS_COMPONENTS.map((id) => `${id}:${before.weights[id]}`),
          after: READINESS_COMPONENTS.map((id) => `${id}:${body.weights[id]}`),
          threshold: body.threshold,
          closingDays: body.closingDays,
        },
      },
      meta,
    );
    return this.configView();
  }

  // ── Scores ─────────────────────────────

  /** Every registered component runs once for all the members; then each member's score is composed. */
  async scores(
    members: ReadinessMember[],
    now = new Date(),
    config?: Config,
  ): Promise<Map<string, ReadinessView>> {
    const c = config ?? (await this.config());
    const active = [...this.components.values()].filter((k) => c.weights[k.id] > 0);
    const results = await Promise.all(
      active.map(async (k) => [k.id, await k.compute(members, now)] as const),
    );
    const out = new Map<string, ReadinessView>();
    for (const m of members)
      out.set(
        m.userId,
        compose(
          c.weights,
          this.registered,
          Object.fromEntries(results.map(([id, r]) => [id, r.get(m.userId) ?? null])),
          now,
        ),
      );
    return out;
  }

  /** The student's own score, components and next steps. Nobody else's. */
  async mine(viewer: AuthState): Promise<ReadinessView> {
    const cohort = await this.d.cohort(viewer.userId);
    const member = {
      userId: viewer.userId,
      branch: cohort?.branch ?? null,
      gradYear: cohort?.gradYear ?? null,
    };
    const view = (await this.scores([member])).get(viewer.userId);
    if (!view) throw forbidden();
    return view;
  }

  // ── The board (TPO and faculty) ─────────────────────────────

  private async ranked(q: z.output<typeof readinessBoardQuery>, now: Date) {
    const config = await this.config();
    // Minors are never ranked or listed (E4, G5): they see only their own score.
    const students = (await this.d.students(q)).filter((s) => !s.minor);
    const scores = await this.scores(students, now, config);
    return { config, students, scores };
  }

  async board(q: z.output<typeof readinessBoardQuery>, now = new Date()): Promise<ReadinessBoardView> {
    const { config, students, scores } = await this.ranked(q, now);
    const groups = new Map<string, { gradYear: number | null; branch: string | null; scores: number[] }>();
    for (const s of students) {
      const key = `${s.gradYear ?? '-'}|${s.branch ?? '-'}`;
      const g = groups.get(key) ?? { gradYear: s.gradYear, branch: s.branch, scores: [] };
      g.scores.push(scores.get(s.userId)?.score ?? 0);
      groups.set(key, g);
    }
    const groupViews: ReadinessGroupView[] = [...groups.values()]
      .sort(
        (a, b) => (b.gradYear ?? 0) - (a.gradYear ?? 0) || String(a.branch).localeCompare(String(b.branch)),
      )
      .map((g) => ({
        gradYear: g.gradYear,
        branch: g.branch as Branch | null,
        students: suppress(g.scores.length),
        bands: READINESS_BANDS.map((_, i) => suppress(g.scores.filter((x) => bandOf(x) === i).length)),
        median: g.scores.length >= SMALL_CELL ? median(g.scores) : null,
      }));
    const all = [...scores.values()];
    const components = READINESS_COMPONENTS.map((id) => {
      const status: 'scored' | 'off' | 'not_available' =
        config.weights[id] <= 0 ? 'off' : this.components.has(id) ? 'scored' : 'not_available';
      const pts = all.flatMap((v) => {
        const c = v.components.find((x) => x.id === id);
        return c?.status === 'scored' ? [c.points] : [];
      });
      return {
        id,
        status,
        average:
          status === 'scored' && pts.length >= SMALL_CELL
            ? Math.round((pts.reduce((a, b) => a + b, 0) / pts.length) * 10) / 10
            : null,
      };
    });
    return {
      threshold: config.threshold,
      closingDays: config.closingDays,
      students: suppress(students.length) as Count,
      components,
      groups: groupViews,
      needsHelp: await this.needsHelp(students, scores, config, now),
      computedAt: now.toISOString(),
    };
  }

  /** Students below the threshold whose next eligible drive closes within the window. */
  private async needsHelp(
    students: Student[],
    scores: Map<string, ReadinessView>,
    config: Config,
    now: Date,
  ): Promise<NeedsHelpRow[]> {
    const below = students.filter((s) => (scores.get(s.userId)?.score ?? 0) < config.threshold);
    if (!below.length) return [];
    const closing = await this.d.nextClosing(
      below.map((s) => s.userId),
      new Date(now.getTime() + config.closingDays * DAY),
    );
    const listed = below.filter((s) => closing.has(s.userId));
    const last = await this.lastNudges(listed.map((s) => s.userId));
    const cooled = now.getTime() - READINESS_NUDGE_COOLDOWN_DAYS * DAY;
    return listed
      .map((s): NeedsHelpRow => {
        const v = scores.get(s.userId);
        const drive = closing.get(s.userId);
        // The component with the most points still to earn, and its next step.
        const weakest = [...(v?.components ?? [])]
          .filter((c) => c.status === 'scored')
          .sort((a, b) => b.max - b.points - (a.max - a.points))[0];
        const at = last.get(s.userId) ?? null;
        return {
          userId: s.userId,
          name: s.name,
          branch: s.branch as Branch | null,
          gradYear: s.gradYear,
          score: v?.score ?? 0,
          drive: {
            id: drive?.driveId ?? '',
            company: drive?.company ?? '',
            closesAt: (drive?.closesAt ?? now).toISOString(),
          },
          next: weakest?.next ?? null,
          lastNudgedAt: at?.toISOString() ?? null,
          nudgeable: !at || at.getTime() < cooled,
        };
      })
      .sort((a, b) => a.drive.closesAt.localeCompare(b.drive.closesAt) || a.score - b.score)
      .slice(0, NEEDS_HELP_MAX);
  }

  private async lastNudges(userIds: string[]): Promise<Map<string, Date>> {
    const rows = await ReadinessNudgeModel.find({
      userId: { $in: userIds.map((u) => new Types.ObjectId(u)) },
    })
      .sort({ createdAt: -1 })
      .select('userId createdAt')
      .limit(50_000)
      .lean<Pick<ReadinessNudgeDoc, 'userId' | 'createdAt'>[]>();
    const out = new Map<string, Date>();
    for (const r of rows) if (!out.has(String(r.userId))) out.set(String(r.userId), r.createdAt);
    return out;
  }

  /**
   * Nudges students on the "needs help" list now, through notifications (WhatsApp where they opted
   * in, within their weekly cap and the college's allowance; otherwise in-app, push or email). A
   * student is nudged at most once in the cool-off, whoever sends it: the nudge is recorded first,
   * and of two at once only the earlier one goes out.
   */
  async nudge(
    actor: AuthState,
    userIds: string[],
    meta: RequestMetaLite,
    now = new Date(),
  ): Promise<ReadinessNudgeResult> {
    const wanted = new Set(userIds);
    const { students, scores, config } = await this.ranked({}, now);
    const rows = (await this.needsHelp(students, scores, config, now)).filter((r) => wanted.has(r.userId));
    const result: ReadinessNudgeResult = { sent: 0, coolingOff: 0, notListed: wanted.size - rows.length };
    const since = new Date(now.getTime() - READINESS_NUDGE_COOLDOWN_DAYS * DAY);
    for (const r of rows) {
      if (!r.nudgeable) {
        result.coolingOff++;
        continue;
      }
      const uid = new Types.ObjectId(r.userId);
      const mine = await ReadinessNudgeModel.create({ userId: uid, driveId: new Types.ObjectId(r.drive.id) });
      const first = await ReadinessNudgeModel.findOne({ userId: uid, createdAt: { $gte: since } })
        .sort({ _id: 1 })
        .select('_id')
        .lean();
      if (first && String(first._id) !== String(mine._id)) {
        await ReadinessNudgeModel.deleteOne({ _id: mine._id });
        result.coolingOff++;
        continue;
      }
      await this.d.notifications.notify(r.userId, 'readiness_nudge', {
        name: firstName(r.name),
        company: r.drive.company,
        driveId: r.drive.id,
        start: r.drive.closesAt,
      });
      await this.track(r.userId, 'readiness_nudged', { driveId: r.drive.id });
      result.sent++;
    }
    await audit.record(
      {
        action: 'readiness.nudged',
        actorId: actor.userId,
        targetType: 'readiness',
        meta: {
          requested: wanted.size,
          sent: result.sent,
          coolingOff: result.coolingOff,
          notListed: result.notListed,
        },
      },
      meta,
    );
    return result;
  }

  /**
   * The board as a file for the placement cell: one row per student (minors never), with each
   * component's points. Audited with its row count.
   */
  async export(
    actor: AuthState,
    q: z.output<typeof readinessBoardQuery>,
    format: 'csv' | 'xlsx',
    meta: RequestMetaLite,
    now = new Date(),
  ) {
    const { students, scores, config } = await this.ranked(q, now);
    const closing = await this.d.nextClosing(
      students.map((s) => s.userId),
      new Date(now.getTime() + config.closingDays * DAY),
    );
    const scored = READINESS_COMPONENTS.filter((id) => config.weights[id] > 0 && this.components.has(id));
    const header = [
      'Name',
      'Branch',
      'Batch',
      'Score',
      ...scored.map((id) => `${id} points`),
      'Next drive closing',
    ];
    const rows = students
      .map((s) => {
        const v = scores.get(s.userId);
        const drive = closing.get(s.userId);
        return [
          s.name,
          s.branch ?? '',
          s.gradYear ?? '',
          v?.score ?? 0,
          ...scored.map((id) => v?.components.find((c) => c.id === id)?.points ?? 0),
          drive ? `${drive.company} (${drive.closesAt.toISOString().slice(0, 10)})` : '',
        ] as (string | number)[];
      })
      .sort((a, b) => Number(a[3]) - Number(b[3]));
    await audit.record(
      {
        action: 'readiness.exported',
        actorId: actor.userId,
        targetType: 'readiness',
        meta: { format, rows: rows.length, branch: q.branch ?? null, gradYear: q.gradYear ?? null },
      },
      meta,
    );
    const name = `readiness-${now.toISOString().slice(0, 10)}`;
    if (format === 'csv') {
      const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
      return { body: Buffer.from(`\uFEFF${csv}`), type: 'text/csv; charset=utf-8', name: `${name}.csv` };
    }
    const sheet = [
      header.map((value) => ({ value, fontWeight: 'bold' as const })),
      ...rows.map((r) =>
        r.map((v) => ({
          value: typeof v === 'number' ? v : String(v),
          type: typeof v === 'number' ? Number : String,
        })),
      ),
    ];
    const body = await writeXlsxFile(sheet as SheetData).toBuffer();
    return {
      body,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      name: `${name}.xlsx`,
    };
  }

  // ── Privacy ─────────────────────────────

  /** What is stored about the member: the nudges they were sent (scores are never stored). */
  async exportFor(userId: string) {
    const nudges = await ReadinessNudgeModel.find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean<ReadinessNudgeDoc[]>();
    return { nudges: nudges.map((n) => ({ driveId: String(n.driveId), at: n.createdAt.toISOString() })) };
  }

  async eraseFor(userId: string) {
    await ReadinessNudgeModel.deleteMany({ userId: new Types.ObjectId(userId) });
  }
}
