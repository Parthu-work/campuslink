import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  BADGES,
  DEFAULT_TIMEZONE,
  XP_RULES,
  currentStreak,
  levelFor,
  mentorLevelFor,
  type BadgeId,
  type LeaderboardRow,
  type MentorLevel,
  type MyProgressView,
  type RedemptionView,
  type RewardView,
  type WallOfMentorsView,
  type XpEventView,
  type XpKind,
  type XpTrack,
  type gamificationPrefsBody,
  type redemptionDecisionBody,
  type rewardBody,
  type rewardUpdateBody,
} from '@campuslink/shared';
import {
  GamificationPrefsModel,
  RedemptionModel,
  RewardModel,
  UserBadgeModel,
  XpEventModel,
  type GamePrefsDoc,
  type RedemptionDoc,
  type RewardDoc,
  type XpDoc,
} from './gamification.model.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { plainText } from '../../lib/text.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { Logger } from '../../lib/logger.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { AuthState } from '../../types.js';

const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;
const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: DEFAULT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
/** Calendar day in the college's timezone. */
export const dayKey = (d: Date) => dayFmt.format(d);
const EARNING: string[] = Object.keys(XP_RULES);

/** Badge rules: the count of an XP kind that earns it (streak badges are checked separately). */
const BADGE_RULES: Partial<Record<BadgeId, { kind: XpKind; count: number }>> = {
  first_step: { kind: 'roadmap_step', count: 1 },
  roadmap_finisher: { kind: 'roadmap_finished', count: 1 },
  helpful_answer: { kind: 'answer_accepted', count: 1 },
  first_session: { kind: 'session_completed', count: 1 },
  event_goer: { kind: 'event_attended', count: 3 },
  mentor_first: { kind: 'session_mentored', count: 1 },
  mentor_10: { kind: 'session_mentored', count: 10 },
  referrer_5: { kind: 'referral_given', count: 5 },
  roadmap_author: { kind: 'roadmap_published', count: 1 },
};

export interface GamificationDeps {
  profiles: ProfilesService;
  notifications: NotificationsService;
  logger: Logger;
}

/**
 * XP, streaks, levels and badges for students; Impact Score and mentor levels for alumni; the
 * rewards catalogue. Points come only from other modules' successful writes (`award`).
 */
export class GamificationService {
  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    const u = oid(userId);
    const [points, badges, redemptions, prefs] = await Promise.all([
      XpEventModel.find({ userId: u }).select('track kind points createdAt note').limit(20_000).lean(),
      UserBadgeModel.find({ userId: u }).select('badge createdAt').lean(),
      RedemptionModel.find({ userId: u }).select('title cost track status createdAt').lean(),
      GamificationPrefsModel.findOne({ userId: u }).select('showOnLeaderboard showOnWall').lean(),
    ]);
    return { points, badges, redemptions, preferences: prefs };
  }

  async eraseFor(userId: string) {
    const u = oid(userId);
    await Promise.all([
      XpEventModel.deleteMany({ userId: u }),
      UserBadgeModel.deleteMany({ userId: u }),
      RedemptionModel.deleteMany({ userId: u }),
      GamificationPrefsModel.deleteMany({ userId: u }),
    ]);
  }

  constructor(private readonly d: GamificationDeps) {}

  // ── Awarding ─────────────────────────────
  /** Award once per (kind, member, item), within the daily cap, never for self-interactions. */
  readonly award = async (
    userId: string | Types.ObjectId,
    kind: XpKind,
    refId: string,
    opts: { from?: string | Types.ObjectId | null } = {},
  ): Promise<void> => {
    try {
      if (opts.from && String(opts.from) === String(userId)) return;
      const rule = XP_RULES[kind];
      const now = new Date();
      const day = dayKey(now);
      if (rule.dailyCap !== null) {
        const today = await XpEventModel.countDocuments({ userId: oid(userId), kind, day });
        if (today >= rule.dailyCap) return;
      }
      try {
        await XpEventModel.create({
          userId: oid(userId),
          track: rule.track,
          kind,
          points: rule.points,
          refId,
          dedupeKey: `${kind}:${String(userId)}:${refId}`,
          day,
        });
      } catch (e) {
        if (isDuplicate(e)) return;
        throw e;
      }
      await this.checkBadges(String(userId), kind);
    } catch (err) {
      // Points are a bonus: never fail the action that earned them.
      this.d.logger.error({ err, kind }, 'award failed');
    }
  };

  private async grantBadge(userId: string, badge: BadgeId) {
    try {
      await UserBadgeModel.create({ userId: oid(userId), badge });
    } catch (e) {
      if (isDuplicate(e)) return;
      throw e;
    }
    await this.d.notifications.notify(userId, 'badge_earned', { badge });
  }

  private async checkBadges(userId: string, kind: XpKind) {
    const me = oid(userId);
    for (const [badge, rule] of Object.entries(BADGE_RULES) as [BadgeId, { kind: XpKind; count: number }][]) {
      if (rule.kind !== kind) continue;
      if ((await XpEventModel.countDocuments({ userId: me, kind })) >= rule.count)
        await this.grantBadge(userId, badge);
    }
    if (XP_RULES[kind].track === 'xp') {
      const streak = await this.streak(me);
      if (streak >= 7) await this.grantBadge(userId, 'streak_7');
      if (streak >= 30) await this.grantBadge(userId, 'streak_30');
    }
  }

  private async streak(userId: Types.ObjectId) {
    const since = dayKey(new Date(Date.now() - 400 * 86_400_000));
    const days = (await XpEventModel.distinct('day', {
      userId,
      track: 'xp',
      points: { $gt: 0 },
      kind: { $in: EARNING },
      day: { $gte: since },
    })) as string[];
    return currentStreak(days, dayKey(new Date()));
  }

  // ── Reading ─────────────────────────────
  private async totals(userId: Types.ObjectId) {
    const rows = await XpEventModel.aggregate<{ _id: { track: XpTrack; earning: boolean }; points: number }>([
      { $match: { userId } },
      {
        $group: {
          _id: { track: '$track', earning: { $in: ['$kind', [...EARNING, 'revoked']] } },
          points: { $sum: '$points' },
        },
      },
    ]);
    const get = (track: XpTrack, earning: boolean) =>
      rows.find((r) => r._id.track === track && r._id.earning === earning)?.points ?? 0;
    // Raw balances can go negative for a moment (concurrent redemptions); callers check that.
    const raw = {
      xp: get('xp', true) + get('xp', false),
      impact: get('impact', true) + get('impact', false),
    };
    return {
      xp: Math.max(0, get('xp', true)),
      impact: Math.max(0, get('impact', true)),
      raw,
      balance: { xp: Math.max(0, raw.xp), impact: Math.max(0, raw.impact) },
    };
  }

  private eventView(e: XpDoc): XpEventView {
    return {
      id: String(e._id),
      kind: e.kind as XpEventView['kind'],
      track: e.track,
      points: e.points,
      createdAt: e.createdAt.toISOString(),
      note: e.note,
    };
  }

  private async prefsOf(userId: Types.ObjectId) {
    const p = await GamificationPrefsModel.findOne({ userId }).lean<GamePrefsDoc>();
    return { showOnLeaderboard: p?.showOnLeaderboard ?? false, showOnWall: p?.showOnWall ?? false };
  }

  async me(viewer: AuthState): Promise<MyProgressView> {
    const me = oid(viewer.userId);
    const [t, streak, badges, prefs, recent, mentees, sessions] = await Promise.all([
      this.totals(me),
      this.streak(me),
      UserBadgeModel.find({ userId: me })
        .sort({ createdAt: 1 })
        .lean<{ badge: BadgeId; createdAt: Date }[]>(),
      this.prefsOf(me),
      XpEventModel.find({ userId: me }).sort({ _id: -1 }).limit(20).lean<XpDoc[]>(),
      XpEventModel.countDocuments({ userId: me, kind: 'new_mentee' }),
      XpEventModel.countDocuments({ userId: me, kind: 'session_mentored' }),
    ]);
    return {
      xp: t.xp,
      level: levelFor(t.xp),
      streak,
      impact: t.impact,
      mentorLevel: mentorLevelFor(t.impact),
      menteesHelped: mentees,
      sessionsMentored: sessions,
      balance: t.balance,
      badges: badges.map((b) => ({ id: b.badge, awardedAt: b.createdAt.toISOString() })),
      prefs,
      recent: recent.map((e) => this.eventView(e)),
    };
  }

  async setPrefs(viewer: AuthState, body: z.output<typeof gamificationPrefsBody>) {
    await GamificationPrefsModel.updateOne({ userId: oid(viewer.userId) }, { $set: body }, { upsert: true });
    return this.prefsOf(oid(viewer.userId));
  }

  private async optedIn(field: 'showOnLeaderboard' | 'showOnWall') {
    return (
      await GamificationPrefsModel.find({ [field]: true })
        .select('userId')
        .limit(5000)
        .lean<GamePrefsDoc[]>()
    ).map((p) => p.userId);
  }

  /** This month's XP among members who opted in (optionally within my branch). */
  async leaderboard(viewer: AuthState, scope: 'college' | 'branch'): Promise<LeaderboardRow[]> {
    const ids = await this.optedIn('showOnLeaderboard');
    if (!ids.length) return [];
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const rows = await XpEventModel.aggregate<{ _id: Types.ObjectId; points: number }>([
      {
        $match: {
          userId: { $in: ids },
          track: 'xp',
          kind: { $in: [...EARNING, 'revoked'] },
          createdAt: { $gte: start },
        },
      },
      { $group: { _id: '$userId', points: { $sum: '$points' } } },
      { $match: { points: { $gt: 0 } } },
      { $sort: { points: -1, _id: 1 } },
      { $limit: 200 },
    ]);
    const authors = await this.d.profiles.authorsFor(
      viewer,
      rows.map((r) => r._id),
    );
    let filtered = rows;
    if (scope === 'branch') {
      const mine =
        (await this.d.profiles.authorsFor(viewer, [viewer.userId])).get(viewer.userId)?.branch ?? null;
      filtered = mine ? rows.filter((r) => authors.get(String(r._id))?.branch === mine) : [];
    }
    return filtered.slice(0, 25).map((r, i) => {
      const a = authors.get(String(r._id));
      return {
        rank: i + 1,
        person: {
          userId: String(r._id),
          name: a?.name ?? 'Former member',
          avatarFileId: a?.avatarFileId ?? null,
        },
        branch: a?.branch ?? null,
        points: r.points,
        isMe: String(r._id) === viewer.userId,
      };
    });
  }

  /** Opted-in mentors with a mentor level, and last month's top mentor. */
  async wall(): Promise<WallOfMentorsView> {
    const ids = await this.optedIn('showOnWall');
    if (!ids.length) return { mentorOfTheMonth: null, mentors: [] };
    const totals = await XpEventModel.aggregate<{ _id: Types.ObjectId; impact: number; mentees: number }>([
      { $match: { userId: { $in: ids }, track: 'impact', kind: { $in: [...EARNING, 'revoked'] } } },
      {
        $group: {
          _id: '$userId',
          impact: { $sum: '$points' },
          mentees: { $sum: { $cond: [{ $eq: ['$kind', 'new_mentee'] }, 1, 0] } },
        },
      },
      { $sort: { impact: -1, _id: 1 } },
      { $limit: 200 },
    ]);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [top] = await XpEventModel.aggregate<{ _id: Types.ObjectId; impact: number }>([
      {
        $match: {
          userId: { $in: ids },
          track: 'impact',
          kind: { $in: [...EARNING, 'revoked'] },
          createdAt: { $gte: monthStart, $lt: monthEnd },
        },
      },
      { $group: { _id: '$userId', impact: { $sum: '$points' } } },
      { $match: { impact: { $gt: 0 } } },
      { $sort: { impact: -1, _id: 1 } },
      { $limit: 1 },
    ]);
    const refs = await this.d.profiles.refsFor([...totals.map((t) => t._id), ...(top ? [top._id] : [])]);
    const person = (id: Types.ObjectId) =>
      refs.get(String(id)) ?? { userId: String(id), name: 'Former member', avatarFileId: null };
    return {
      mentorOfTheMonth: top
        ? { person: person(top._id), month: monthStart.toISOString().slice(0, 7), impact: top.impact }
        : null,
      mentors: totals.flatMap((t) => {
        const level = mentorLevelFor(t.impact);
        return level
          ? [
              {
                person: person(t._id),
                level: level as MentorLevel,
                impact: t.impact,
                menteesHelped: t.mentees,
              },
            ]
          : [];
      }),
    };
  }

  // ── Rewards ─────────────────────────────
  private rewardView(r: RewardDoc): RewardView {
    return {
      id: String(r._id),
      title: r.title,
      description: r.description,
      kind: r.kind,
      track: r.track,
      cost: r.cost,
      stock: r.stock ?? null,
      active: r.active,
    };
  }

  async rewards(all: boolean) {
    const rows = await RewardModel.find(all ? {} : { active: true })
      .sort({ cost: 1 })
      .limit(200)
      .lean<RewardDoc[]>();
    return rows.map((r) => this.rewardView(r));
  }

  async createReward(viewer: AuthState, body: z.output<typeof rewardBody>, meta: RequestMetaLite) {
    const r = await RewardModel.create({
      ...body,
      title: plainText(body.title),
      description: plainText(body.description),
      createdBy: oid(viewer.userId),
    });
    await audit.record(
      { action: 'reward.created', actorId: viewer.userId, targetType: 'reward', targetId: String(r._id) },
      meta,
    );
    return this.rewardView(r.toObject() as RewardDoc);
  }

  async updateReward(
    viewer: AuthState,
    id: string,
    body: z.output<typeof rewardUpdateBody>,
    meta: RequestMetaLite,
  ) {
    const set: Record<string, unknown> = { ...body };
    if (body.title !== undefined) set.title = plainText(body.title);
    if (body.description !== undefined) set.description = plainText(body.description);
    const r = await RewardModel.findOneAndUpdate(
      { _id: id },
      { $set: set },
      { returnDocument: 'after' },
    ).lean<RewardDoc>();
    if (!r) throw notFound('Reward');
    await audit.record(
      { action: 'reward.updated', actorId: viewer.userId, targetType: 'reward', targetId: id },
      meta,
    );
    return this.rewardView(r);
  }

  private async redemptionViews(rows: RedemptionDoc[]): Promise<RedemptionView[]> {
    const refs = await this.d.profiles.refsFor(rows.map((r) => r.userId));
    return rows.map((r) => ({
      id: String(r._id),
      reward: { id: String(r.rewardId), title: r.title, kind: r.kind },
      person: refs.get(String(r.userId)) ?? {
        userId: String(r.userId),
        name: 'Former member',
        avatarFileId: null,
      },
      track: r.track,
      cost: r.cost,
      status: r.status,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    }));
  }

  /** Spend points on a reward. Stock and balance are checked atomically; overspends roll back. */
  async redeem(viewer: AuthState, rewardId: string) {
    const me = oid(viewer.userId);
    await GamificationPrefsModel.updateOne(
      { userId: me },
      { $setOnInsert: { userId: me } },
      { upsert: true },
    ).catch((e: unknown) => {
      if (!isDuplicate(e)) throw e;
    });
    const now = new Date();
    const locked = await GamificationPrefsModel.updateOne(
      { userId: me, $or: [{ redeemLockUntil: null }, { redeemLockUntil: { $lt: now } }] },
      { $set: { redeemLockUntil: new Date(now.getTime() + 15_000) } },
    );
    if (!locked.modifiedCount)
      throw conflict('Another reward request is in progress. Try again in a moment.');
    try {
      return await this.redeemLocked(me, rewardId);
    } finally {
      await GamificationPrefsModel.updateOne({ userId: me }, { $set: { redeemLockUntil: null } });
    }
  }

  private async redeemLocked(me: Types.ObjectId, rewardId: string) {
    const reward = await RewardModel.findOne({ _id: rewardId, active: true }).lean<RewardDoc>();
    if (!reward) throw notFound('Reward');
    const { raw } = await this.totals(me);
    if (raw[reward.track] < reward.cost) throw badRequest('You don’t have enough points for this yet');
    if (reward.stock !== null && reward.stock !== undefined) {
      const took = await RewardModel.updateOne(
        { _id: reward._id, active: true, stock: { $gt: 0 } },
        { $inc: { stock: -1 } },
      );
      if (!took.modifiedCount) throw conflict('This reward is out of stock');
    }
    const red = await RedemptionModel.create({
      userId: me,
      rewardId: reward._id,
      title: reward.title,
      kind: reward.kind,
      track: reward.track,
      cost: reward.cost,
    });
    await XpEventModel.create({
      userId: me,
      track: reward.track,
      kind: 'redeemed',
      points: -reward.cost,
      refId: String(red._id),
      dedupeKey: `redeemed:${String(red._id)}`,
      day: dayKey(new Date()),
      note: reward.title,
    });
    return (await this.redemptionViews([red.toObject() as RedemptionDoc]))[0];
  }

  private async refund(r: RedemptionDoc, status: 'cancelled' | 'rejected', note: string, actorId?: string) {
    const res = await RedemptionModel.updateOne(
      { _id: r._id, status: 'pending' },
      { $set: { status, note, decidedAt: new Date(), ...(actorId ? { decidedBy: oid(actorId) } : {}) } },
    );
    if (!res.modifiedCount) return false;
    await XpEventModel.create({
      userId: r.userId,
      track: r.track,
      kind: 'refund',
      points: r.cost,
      refId: String(r._id),
      dedupeKey: `refund:${String(r._id)}`,
      day: dayKey(new Date()),
      note: r.title,
    });
    await RewardModel.updateOne({ _id: r.rewardId, stock: { $ne: null } }, { $inc: { stock: 1 } });
    return true;
  }

  async myRedemptions(viewer: AuthState) {
    const rows = await RedemptionModel.find({ userId: oid(viewer.userId) })
      .sort({ _id: -1 })
      .limit(50)
      .lean<RedemptionDoc[]>();
    return this.redemptionViews(rows);
  }

  async cancelRedemption(viewer: AuthState, id: string) {
    const r = await RedemptionModel.findOne({ _id: id, userId: oid(viewer.userId) }).lean<RedemptionDoc>();
    if (!r) throw notFound('Redemption');
    if (!(await this.refund(r, 'cancelled', ''))) throw conflict('This redemption was already decided');
    return { cancelled: true };
  }

  async redemptions(status?: string) {
    const rows = await RedemptionModel.find(status ? { status } : {})
      .sort({ _id: -1 })
      .limit(100)
      .lean<RedemptionDoc[]>();
    return this.redemptionViews(rows);
  }

  async decide(
    viewer: AuthState,
    id: string,
    body: z.output<typeof redemptionDecisionBody>,
    meta: RequestMetaLite,
  ) {
    const r = await RedemptionModel.findById(id).lean<RedemptionDoc>();
    if (!r) throw notFound('Redemption');
    const note = plainText(body.note);
    if (body.decision === 'reject') {
      if (!(await this.refund(r, 'rejected', note, viewer.userId)))
        throw conflict('This redemption was already decided');
    } else {
      const res = await RedemptionModel.updateOne(
        { _id: r._id, status: 'pending' },
        { $set: { status: 'fulfilled', note, decidedBy: oid(viewer.userId), decidedAt: new Date() } },
      );
      if (!res.modifiedCount) throw conflict('This redemption was already decided');
    }
    await audit.record(
      {
        action: `reward.${body.decision === 'fulfil' ? 'fulfilled' : 'rejected'}`,
        actorId: viewer.userId,
        targetType: 'redemption',
        targetId: id,
      },
      meta,
    );
    await this.d.notifications.notify(r.userId, 'redemption_decided', {
      reward: r.title,
      decision: body.decision === 'fulfil' ? 'fulfilled' : 'rejected',
    });
    return (
      await this.redemptionViews([
        (await RedemptionModel.findById(id).lean<RedemptionDoc>()) as RedemptionDoc,
      ])
    )[0];
  }

  // ── Admin audit tools ─────────────────────────────
  async ledger(userId: string) {
    const rows = await XpEventModel.find({ userId: oid(userId) })
      .sort({ _id: -1 })
      .limit(200)
      .lean<XpDoc[]>();
    return rows.map((e) => this.eventView(e));
  }

  /** Revoke an award: a negative entry with a reason (the original stays, append-only). */
  async revoke(viewer: AuthState, eventId: string, reason: string, meta: RequestMetaLite) {
    const e = await XpEventModel.findById(eventId).lean<XpDoc>();
    if (!e || !EARNING.includes(e.kind) || e.points <= 0) throw notFound('Award');
    try {
      await XpEventModel.create({
        userId: e.userId,
        track: e.track,
        kind: 'revoked',
        points: -e.points,
        refId: String(e._id),
        dedupeKey: `revoked:${String(e._id)}`,
        day: dayKey(new Date()),
        note: plainText(reason),
        actorId: oid(viewer.userId),
      });
    } catch (err) {
      if (isDuplicate(err)) throw conflict('This award was already revoked');
      throw err;
    }
    await audit.record(
      {
        action: 'xp.revoked',
        actorId: viewer.userId,
        targetType: 'user',
        targetId: String(e.userId),
        meta: { kind: e.kind, points: e.points },
      },
      meta,
    );
    return { revoked: true };
  }

  /** For analytics: counts of awards of these kinds since a date (aggregated). */
  async countSince(kinds: XpKind[], since: Date) {
    return XpEventModel.countDocuments({ kind: { $in: kinds }, createdAt: { $gte: since } });
  }

  /** Badges known to the client (for the progress page). */
  readonly badgeIds = BADGES;
}
