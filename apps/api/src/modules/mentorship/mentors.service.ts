import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  DEFAULT_DURATIONS,
  DEFAULT_TIMEZONE,
  SESSION_TYPES,
  isBookable,
  type AvailabilityBody,
  type MatchReason,
  type MenteeAudience,
  type MentorCard,
  type MentorMatch,
  type MentorSettingsBody,
  type MentorSettingsView,
  type PublicProfile,
  type Role,
  type SessionType,
  type SlotsView,
  type mentorsQuery,
  type slotsQuery,
} from '@campuslink/shared';
import { MentorProfileModel, MenteePrefsModel, type MentorDoc } from './mentor.model.js';
import { MentorshipRequestModel } from './request.model.js';
import { computeSlots, type AvailabilityRules } from './slots.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { SafetyService } from '../moderation/safety.service.js';
import type { SessionsService, SlotCheck } from '../sessions/sessions.service.js';
import type { AuthState } from '../../types.js';

const WEEK_MS = 7 * 24 * 3600_000;
const DEFAULT_TYPES: MentorSettingsBody['sessionTypes'] = SESSION_TYPES.map((type) => ({
  type,
  enabled: type === 'quick_chat' || type === 'video_1on1',
  durationMin: DEFAULT_DURATIONS[type] as MentorSettingsBody['sessionTypes'][number]['durationMin'],
}));

/** Company names compare loosely: case, punctuation, "(demo)" and legal suffixes are ignored. */
export const normaliseCompany = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(
      /\b(private|pvt|limited|ltd|inc|llp|llc|corp|corporation|technologies|technology|solutions)\b\.?/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const norm = (s: string) => s.toLowerCase().trim();

export function audienceAllows(audience: MenteeAudience, roles: Role[]): boolean {
  if (audience === 'students') return roles.includes('STUDENT');
  if (audience === 'alumni') return roles.includes('ALUMNI');
  return true;
}

/** Alumni Match score (0–100) with the reasons shown to the mentee. Uses only fields the mentee can see. */
export function scoreMatch(
  mentee: {
    branch: string | null;
    goals: string[];
    targetCompanies: string[];
    skills: string[];
    languages: string[];
  },
  mentor: PublicProfile,
): { score: number; reasons: MatchReason[] } {
  const f = mentor.fields;
  const reasons: MatchReason[] = [];
  let score = 0;
  if (mentee.branch && f.branch && f.branch === mentee.branch) {
    score += 20;
    reasons.push({ kind: 'branch', value: f.branch });
  }
  const company = f.company ? normaliseCompany(f.company) : '';
  if (company && mentee.targetCompanies.some((c) => normaliseCompany(c) === company)) {
    score += 30;
    reasons.push({ kind: 'company', value: f.company ?? '' });
  }
  const mentorTopics = new Set([...(f.topics ?? []), ...(f.skills ?? [])].map(norm));
  const goals = [...new Set(mentee.goals.map(norm))].filter((g) => mentorTopics.has(g));
  if (goals.length) {
    score += Math.min(30, goals.length * 10);
    reasons.push({ kind: 'goals', values: goals });
  }
  const mentorSkills = new Set((f.skills ?? []).map(norm));
  const skills = [...new Set(mentee.skills.map(norm))].filter(
    (s) => mentorSkills.has(s) && !goals.includes(s),
  );
  if (skills.length) {
    score += Math.min(15, skills.length * 5);
    reasons.push({ kind: 'skills', values: skills });
  }
  const mentorLangs = new Set((f.languages ?? []).map(norm));
  const langs = [...new Set(mentee.languages.map(norm))].filter((l) => mentorLangs.has(l));
  if (langs.length) {
    score += 5;
    reasons.push({ kind: 'languages', values: langs });
  }
  return { score: Math.min(100, score), reasons };
}

export class MentorsService {
  constructor(
    private readonly d: { profiles: ProfilesService; safety: SafetyService; sessions: SessionsService },
  ) {}

  private async load(userId: string): Promise<MentorDoc | null> {
    return MentorProfileModel.findOne({ userId }).lean<MentorDoc>();
  }

  private settingsOf(m: MentorDoc | null): MentorSettingsView {
    const types = DEFAULT_TYPES.map((t) => {
      const s = m?.sessionTypes.find((x) => x.type === t.type);
      return s
        ? { type: t.type, enabled: !!s.enabled, durationMin: s.durationMin as typeof t.durationMin }
        : t;
    });
    return {
      accepting: m?.accepting ?? false,
      weeklyCap: m?.weeklyCap ?? 5,
      audience: (m?.audience ?? 'both') as MenteeAudience,
      sessionTypes: types,
      minNoticeHours: m?.minNoticeHours ?? 12,
      horizonDays: m?.horizonDays ?? 30,
      bufferMin: (m?.bufferMin ?? 0) as MentorSettingsBody['bufferMin'],
      availability: {
        timezone: m?.timezone ?? DEFAULT_TIMEZONE,
        weekly: (m?.weekly ?? []).map((w) => ({
          day: w.day ?? 0,
          windows: w.windows.map((x) => ({ start: x.start ?? '', end: x.end ?? '' })),
        })),
        exceptions: (m?.exceptions ?? []).map((e) => ({
          date: e.date ?? '',
          windows: e.windows.map((x) => ({ start: x.start ?? '', end: x.end ?? '' })),
        })),
      },
    };
  }

  async settings(viewer: AuthState): Promise<MentorSettingsView> {
    return this.settingsOf(await this.load(viewer.userId));
  }

  async updateSettings(viewer: AuthState, body: MentorSettingsBody) {
    await MentorProfileModel.updateOne(
      { userId: viewer.userId },
      { $set: { ...body, userId: new Types.ObjectId(viewer.userId) } },
      { upsert: true },
    );
    return this.settings(viewer);
  }

  async updateAvailability(viewer: AuthState, body: AvailabilityBody) {
    const sortDay = [...body.weekly].sort((a, b) => a.day - b.day);
    await MentorProfileModel.updateOne(
      { userId: viewer.userId },
      {
        $set: {
          userId: new Types.ObjectId(viewer.userId),
          timezone: body.timezone,
          weekly: sortDay,
          exceptions: [...body.exceptions].sort((a, b) => a.date.localeCompare(b.date)),
        },
      },
      { upsert: true },
    );
    return this.settings(viewer);
  }

  async prefs(viewer: AuthState) {
    const p = await MenteePrefsModel.findOne({ userId: viewer.userId }).lean();
    return { goals: p?.goals ?? [], targetCompanies: p?.targetCompanies ?? [] };
  }

  async updatePrefs(viewer: AuthState, body: { goals: string[]; targetCompanies: string[] }) {
    await MenteePrefsModel.updateOne({ userId: viewer.userId }, { $set: body }, { upsert: true });
    return this.prefs(viewer);
  }

  /** Requests received in the last 7 days that count against the weekly cap. */
  private async receivedCounts(mentorIds: Types.ObjectId[]): Promise<Map<string, number>> {
    const rows = await MentorshipRequestModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      {
        $match: {
          mentorId: { $in: mentorIds },
          createdAt: { $gte: new Date(Date.now() - WEEK_MS) },
          status: { $in: ['pending', 'accepted'] },
        },
      },
      { $group: { _id: '$mentorId', n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.n]));
  }

  private card(p: PublicProfile, m: MentorDoc, received: number): MentorCard {
    const settings = this.settingsOf(m);
    return {
      userId: p.userId,
      name: p.name,
      avatarFileId: p.avatarFileId,
      headline: p.fields.headline ?? '',
      company: p.fields.company ?? '',
      jobTitle: p.fields.jobTitle ?? '',
      branch: (p.fields.branch ?? null) as MentorCard['branch'],
      gradYear: p.fields.gradYear ?? null,
      topics: p.fields.topics ?? [],
      skills: p.fields.skills ?? [],
      languages: p.fields.languages ?? [],
      sessionTypes: settings.sessionTypes
        .filter((t) => t.enabled)
        .map((t) => ({ type: t.type, durationMin: t.durationMin })),
      open: settings.accepting && received < settings.weeklyCap,
      companyVerified: !!p.companyVerified,
    };
  }

  /** Mentors the viewer may approach: accepting, verified, audience fits, nobody blocked anybody. */
  private async candidates(viewer: AuthState, sessionType?: SessionType) {
    const hidden = await this.d.safety.hiddenFor(viewer.userId);
    const mentors = (
      await MentorProfileModel.find({ accepting: true }).sort({ _id: -1 }).limit(2000).lean<MentorDoc[]>()
    ).filter(
      (m) =>
        String(m.userId) !== viewer.userId &&
        !hidden.has(String(m.userId)) &&
        audienceAllows(m.audience as MenteeAudience, viewer.roles) &&
        (!sessionType || m.sessionTypes.some((t) => t.type === sessionType && t.enabled)),
    );
    const byUser = new Map(mentors.map((m) => [String(m.userId), m]));
    const views = await this.d.profiles.viewsFor(
      viewer,
      mentors.map((m) => m.userId),
    );
    const counts = await this.receivedCounts(mentors.map((m) => m.userId));
    return views.flatMap((p) => {
      const m = byUser.get(p.userId);
      return m ? [{ profile: p, mentor: m, card: this.card(p, m, counts.get(p.userId) ?? 0) }] : [];
    });
  }

  async list(viewer: AuthState, q: z.output<typeof mentorsQuery>) {
    let all = await this.candidates(viewer, q.sessionType);
    if (q.q) {
      const needle = norm(q.q);
      all = all.filter(({ card }) =>
        [card.name, card.headline, card.company, card.jobTitle, ...card.topics, ...card.skills].some((v) =>
          norm(v).includes(needle),
        ),
      );
    }
    if (q.topic) {
      const t = norm(q.topic);
      all = all.filter(({ card }) => [...card.topics, ...card.skills].some((v) => norm(v) === t));
    }
    const start = q.cursor ? all.findIndex((c) => c.card.userId === q.cursor) + 1 : 0;
    const page = all.slice(start, start + q.limit);
    return {
      items: page.map((c) => c.card),
      nextCursor: start + q.limit < all.length ? (page.at(-1)?.card.userId ?? null) : null,
    };
  }

  async get(
    viewer: AuthState,
    mentorId: string,
  ): Promise<MentorCard & { audience: MenteeAudience; timezone: string }> {
    const m = await this.load(mentorId);
    if (
      !m ||
      !m.accepting ||
      mentorId === viewer.userId ||
      (await this.d.safety.isBlockedEither(viewer.userId, mentorId))
    )
      throw notFound('Mentor');
    const [p] = await this.d.profiles.viewsFor(viewer, [m.userId]);
    if (!p) throw notFound('Mentor');
    const counts = await this.receivedCounts([m.userId]);
    return {
      ...this.card(p, m, counts.get(mentorId) ?? 0),
      audience: m.audience as MenteeAudience,
      timezone: m.timezone,
    };
  }

  private rules(m: MentorDoc): AvailabilityRules {
    const s = this.settingsOf(m);
    return {
      timezone: s.availability.timezone,
      weekly: s.availability.weekly,
      exceptions: s.availability.exceptions,
      minNoticeHours: s.minNoticeHours,
      horizonDays: s.horizonDays,
      bufferMin: s.bufferMin,
    };
  }

  private duration(m: MentorDoc, type: SessionType): number {
    const t = m.sessionTypes.find((x) => x.type === type && x.enabled);
    if (!t?.durationMin || !isBookable(type))
      throw badRequest('This mentor does not offer that session type');
    return t.durationMin;
  }

  private async freeSlots(
    m: MentorDoc,
    menteeId: string,
    type: SessionType,
    from: Date,
    days: number,
    ignoreBookingId?: string,
  ) {
    const durationMin = this.duration(m, type);
    const to = new Date(from.getTime() + (days + 1) * 86_400_000);
    const busy = await this.d.sessions.busy([String(m.userId), menteeId], from, to, ignoreBookingId);
    return {
      durationMin,
      slots: computeSlots({
        rules: this.rules(m),
        durationMin,
        mentorId: String(m.userId),
        menteeId,
        busy,
        from,
        days,
      }),
    };
  }

  async slots(viewer: AuthState, mentorId: string, q: z.output<typeof slotsQuery>): Promise<SlotsView> {
    await this.get(viewer, mentorId); // visibility, blocks and pause
    const m = (await this.load(mentorId)) as MentorDoc;
    const from = q.from ? new Date(q.from) : new Date();
    const r = await this.freeSlots(m, viewer.userId, q.type, from, q.days);
    return { timezone: m.timezone, durationMin: r.durationMin, slots: r.slots };
  }

  /** Free slots for a known pair (mentor answering a request, or either side rescheduling). */
  async slotsForPair(
    mentorId: string,
    menteeId: string,
    type: SessionType,
    days: number,
    ignoreBookingId?: string,
  ): Promise<SlotsView> {
    const m = await this.load(mentorId);
    if (!m) throw conflict('This mentor is not taking sessions right now');
    const r = await this.freeSlots(m, menteeId, type, new Date(), days, ignoreBookingId);
    return { timezone: m.timezone, durationMin: r.durationMin, slots: r.slots };
  }

  /** SessionsService hook: is this exact start still bookable for both people? */
  readonly checkSlot: SlotCheck = async ({ mentorId, menteeId, sessionType, start, ignoreBookingId }) => {
    const m = await this.load(mentorId);
    if (!m) throw conflict('This mentor is not taking sessions right now');
    if (Number.isNaN(start.getTime())) throw badRequest('Invalid time');
    const r = await this.freeSlots(
      m,
      menteeId,
      sessionType,
      new Date(start.getTime() - 60_000),
      1,
      ignoreBookingId,
    );
    if (!r.slots.includes(start.toISOString()))
      throw conflict('That time is no longer free. Pick another slot.');
    return { durationMin: r.durationMin, bufferMin: m.bufferMin };
  };

  /** Request preconditions. Unknown, hidden and blocked mentors all read as "not found". */
  async assertRequestable(viewer: AuthState, mentorId: string, type: SessionType): Promise<MentorDoc> {
    if (mentorId === viewer.userId) throw badRequest('You cannot send a request to yourself');
    const m = await this.load(mentorId);
    if (
      !m ||
      !(await this.d.profiles.isActiveMember(mentorId)) ||
      (await this.d.safety.isBlockedEither(viewer.userId, mentorId))
    )
      throw notFound('Mentor');
    if (!m.accepting) throw conflict('This mentor has paused new requests');
    if (!audienceAllows(m.audience as MenteeAudience, viewer.roles))
      throw conflict(
        m.audience === 'students' ? 'This mentor guides students only' : 'This mentor guides alumni only',
      );
    if (!m.sessionTypes.some((t) => t.type === type && t.enabled))
      throw badRequest('This mentor does not offer that session type');
    const received = (await this.receivedCounts([m.userId])).get(mentorId) ?? 0;
    if (received >= m.weeklyCap)
      throw conflict('This mentor’s requests are full for this week. Try again later or ask another mentor.');
    return m;
  }

  async match(viewer: AuthState): Promise<MentorMatch[]> {
    const [prefs, own] = await Promise.all([this.prefs(viewer), this.d.profiles.own(viewer.userId)]);
    const mentee = { ...prefs, branch: own.branch, skills: own.skills, languages: own.languages };
    const scored = (await this.candidates(viewer))
      .filter((c) => c.card.open)
      .map((c) => ({ ...c, ...scoreMatch(mentee, c.profile) }))
      .sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name))
      .slice(0, 20);
    // Availability bonus for the shortlist only (slot computation is the expensive part).
    const now = new Date();
    for (const s of scored) {
      const type = s.card.sessionTypes.find((t) => isBookable(t.type))?.type;
      if (!type) continue;
      const free = await this.freeSlots(s.mentor, viewer.userId, type, now, 14).catch(() => ({ slots: [] }));
      if (free.slots.length) {
        s.score = Math.min(100, s.score + 5);
        s.reasons.push({ kind: 'available' });
      }
    }
    return scored
      .sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name))
      .map((s) => ({ mentor: s.card, score: s.score, reasons: s.reasons }));
  }

  async timezoneOf(userId: string) {
    return (await this.load(userId))?.timezone ?? DEFAULT_TIMEZONE;
  }
}
