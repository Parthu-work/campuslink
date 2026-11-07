/**
 * DEMO (prompt 2, G13): a full placement year for each demo college, so every Prompt 2 screen and
 * the YC metrics pack have something to show. Every person, company, question and answer here is
 * FICTIONAL and labelled demo (CLAUDE.md: never invent real data):
 *
 * - three batches of "Demo Student" / "Demo Alumnus" members (2025 and 2026 graduated, 2027 in its
 *   final year, 2028 in its third year) on the college's list;
 * - two past placement seasons and this one at three demo companies: drives with rounds, results
 *   and verified offers, so each company page clears the five-record threshold in every section;
 * - the placed alumni as "alumni there", mentors and referrers, with completed sessions before
 *   this season's drives (outcome-proven matching) and referrals whose outcome students reported;
 * - published interview write-ups and one waiting for review;
 * - résumés with ATS checks, mock interviews and practice sets run through the real services with
 *   the built-in mock AI, so the stored records are exactly what the app produces;
 * - micro-asks, weekly office hours and certificates (G6); a circle, Next Steps and peer mentors
 *   (G7); member invites and the college outcomes page (G8); the network (G12, ADR 0014 approved);
 * - 52 weeks of product events recorded under the track rules (adults with the
 *   `analytics_aggregate` consent only; two demo members withdrew it and have none), and AI usage
 *   replayed from the measured per-request tokens of each feature.
 *
 * Everything is derived from a fixed seed per college, so `pnpm seed` (which drops the database
 * first) gives the same counts every time.
 */
import { Types } from 'mongoose';
import {
  academicYearOf,
  atsCheckBody,
  chatAskBody,
  ctcBand,
  eventBody,
  interviewCreateBody,
  isoWeek,
  microAskBody,
  circleBody,
  publicPageBody,
  resumeCreateBody,
  PRIVACY_NOTICE_VERSION,
  type Branch,
  type ProductEventName,
  type Role,
} from '@campuslink/shared';
import type { Env } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { MemoryMailProvider } from '../lib/mailer.js';
import { InlineJobQueue } from '../lib/jobs.js';
import { storageFromEnv } from '../lib/storage-factory.js';
import { companyKey } from '../lib/company.js';
import type { FieldCipher } from '../lib/crypto.js';
import { createApp } from '../app.js';
import { findTenantById } from '../modules/tenants/tenant.cache.js';
import { backgroundAuth } from '../modules/users/users.service.js';
import { ConsentModel } from '../modules/consent/consent.model.js';
import { ProfileModel } from '../modules/profiles/profile.model.js';
import { WhitelistModel } from '../modules/imports/whitelist.model.js';
import {
  AcademicRecordModel,
  DriveRegistrationModel,
  OfferModel,
  PlacementCompanyModel,
  PlacementDriveModel,
} from '../modules/placements/placements.model.js';
import { MentorProfileModel } from '../modules/mentorship/mentor.model.js';
import { MentorshipRequestModel } from '../modules/mentorship/request.model.js';
import { BookingModel, FeedbackModel } from '../modules/sessions/booking.model.js';
import { holdsFor } from '../modules/mentorship/slots.js';
import { randomRoomName } from '../lib/video.js';
import { JobModel } from '../modules/jobs/job.model.js';
import { ReferralPrefsModel, ReferralRequestModel } from '../modules/referrals/referral.model.js';
import { ExperienceModel } from '../modules/graph/graph.model.js';
import { ResumeCommentModel } from '../modules/resumes/resume.model.js';
import { MicroAskModel } from '../modules/alumni/alumni.model.js';
import { ProductEventModel } from '../modules/insights/insights.model.js';
import { AiUsageModel } from '../modules/study/ai-usage.model.js';
import type { ResumesService } from '../modules/resumes/resumes.service.js';
import type { InterviewsService } from '../modules/interviews/interviews.service.js';
import type { PracticeService } from '../modules/practice/practice.service.js';
import type { MicroAsksService } from '../modules/alumni/micro-asks.service.js';
import type { RecognitionService } from '../modules/alumni/recognition.service.js';
import type { EventsService } from '../modules/events/events.service.js';
import type { CirclesService } from '../modules/circles/circles.service.js';
import type { NextStepService } from '../modules/next-step/next-step.service.js';
import type { PeersService } from '../modules/peers/peers.service.js';
import type { PublicPagesService } from '../modules/public-pages/public-pages.service.js';
import type { OnboardingService } from '../modules/verification/onboarding.service.js';
import type { CopilotService } from '../modules/copilot/copilot.service.js';
import type { NetworkService } from '../modules/network/network.service.js';
import type { ChatService } from '../modules/study/chat.service.js';

const DAY = 24 * 3600_000;

/** A small deterministic generator (mulberry32), seeded per college: the same seed gives the same year. */
function generator(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p: number) => next() < p,
  };
}

/** The demo companies every season recruits from (all fictional; created by the base seed). */
const COMPANIES = [
  {
    name: 'Nimbus Labs (demo)',
    role: 'Software Engineer',
    ctc: [6, 8.5] as const,
    branches: ['CSE', 'IT', 'ECE'] as Branch[],
    topic: 'Backend',
  },
  {
    name: 'Kestrel Analytics (demo)',
    role: 'Data Analyst',
    ctc: [6.5, 7.5] as const,
    branches: [] as Branch[],
    topic: 'Data',
  },
  {
    name: 'Brightwave Systems (demo)',
    role: 'Associate Engineer',
    ctc: [5, 6] as const,
    branches: [] as Branch[],
    topic: 'Testing',
  },
] as const;

/** Batches: graduation year, size, role now, and the branch mix (repeated in order). */
const BATCHES = [
  { gradYear: 2025, size: 20, role: 'ALUMNI' as Role, mix: ['CSE', 'CSE', 'ECE', 'IT'] as Branch[] },
  { gradYear: 2026, size: 24, role: 'ALUMNI' as Role, mix: ['CSE', 'CSE', 'ECE', 'IT'] as Branch[] },
  {
    gradYear: 2027,
    size: 30,
    role: 'STUDENT' as Role,
    mix: ['CSE', 'CSE', 'ECE', 'IT', 'CSE', 'MECH'] as Branch[],
  },
  { gradYear: 2028, size: 12, role: 'STUDENT' as Role, mix: ['CSE', 'ECE', 'IT'] as Branch[] },
];

/** Per season: how many register for each drive and how many are selected (positions 0…selected-1). */
const DRIVE_SIZE = 14;
const SELECTED = 6;

const ANSWER =
  'DEMO answer: in my third-year project our team missed a demo deadline. I owned the backend, so I split the work into daily goals, fixed the slow database queries myself and told the team early. We shipped two days later and I learned to raise problems sooner.';
const JD =
  'DEMO job description: Software engineer, freshers. Java or Python, data structures and algorithms, SQL, REST APIs, Git, unit testing, problem solving and clear communication.';

/** Fictional write-up questions per round kind, in a senior's own words (labelled demo). */
const WRITE_UP: Record<string, { name: string; questions: string[]; notes: string }> = {
  aptitude: {
    name: 'Online assessment',
    questions: [
      'DEMO: twenty quantitative questions in thirty minutes, mostly percentages and time and work.',
      'DEMO: two easy coding questions, one on strings and one on arrays.',
    ],
    notes: 'DEMO: no negative marking that year; attempt everything.',
  },
  technical: {
    name: 'Technical interview',
    questions: [
      'DEMO: explain the difference between a process and a thread.',
      'DEMO: walk through one project and the hardest bug in it.',
      'DEMO: write a query for the second highest salary in a table.',
    ],
    notes: 'DEMO: they cared more about reasoning out loud than the final answer.',
  },
  hr: {
    name: 'HR interview',
    questions: ['DEMO: why this company?', 'DEMO: are you open to relocating?'],
    notes: 'DEMO: short and friendly.',
  },
};

/** A write-up round as stored: each question a `{ text }` entry not yet sent to a bank. */
const writeUpRound = (kind: string) => {
  const r = WRITE_UP[kind];
  return {
    kind,
    name: r?.name ?? '',
    questions: (r?.questions ?? []).map((text) => ({ text, sent: null })),
    notes: r?.notes ?? '',
  };
};

type Person = {
  id: Types.ObjectId;
  name: string;
  email: string;
  branch: Branch;
  gradYear: number;
  role: Role;
  roll: string;
  /** Set once the person has a verified job offer: the company index and role. */
  placed: { company: number; offerId: Types.ObjectId; ctc: number; at: Date } | null;
};

export interface YearContext {
  tenantId: Types.ObjectId;
  slug: string;
  prefix: string;
  domain: string;
  ids: Map<string, Types.ObjectId>;
  cipher: FieldCipher;
  addUser: (email: string, name: string, roles: Role[]) => Promise<Types.ObjectId>;
}

export interface YearSummary {
  members: number;
  drives: number;
  offers: number;
  sessions: number;
  referrals: number;
  writeUps: number;
  resumes: number;
  mocks: number;
  practiceSets: number;
  events: number;
}

interface Services {
  resumes: ResumesService;
  interviews: InterviewsService;
  practice: PracticeService;
  microAsks: MicroAsksService;
  recognition: RecognitionService;
  events: EventsService;
  circles: CirclesService;
  nextStep: NextStepService;
  peers: PeersService;
  publicPages: PublicPagesService;
  onboarding: OnboardingService;
  copilot: CopilotService;
  network: NetworkService;
  chat: ChatService;
}

export function yearSeeder(env: Env) {
  const jobs = new InlineJobQueue();
  const app = createApp({
    env,
    logger: createLogger('silent'),
    readiness: {},
    mailer: new MemoryMailProvider(),
    jobs,
    storage: storageFromEnv(env).storage,
  });
  const s = app.locals.services as Services;
  const meta = { requestId: 'seed', ip: '127.0.0.1', userAgent: 'seed', device: 'seed' };

  async function seedYear(ctx: YearContext): Promise<YearSummary> {
    const tenant = await findTenantById(ctx.tenantId);
    if (!tenant) throw new Error('Year seed: the college is missing');
    const rand = generator(`campuslink-demo-year-${ctx.slug}`);
    const now = Date.now();
    const at = (daysAgo: number, hourUtc = 9, minute = 0) => {
      const d = new Date(now - daysAgo * DAY);
      d.setUTCHours(hourUtc, minute, 0, 0);
      return d;
    };
    const id = (local: string) => {
      const v = ctx.ids.get(local);
      if (!v) throw new Error(`Year seed: missing ${local}`);
      return v;
    };
    const auth = async (userId: Types.ObjectId) => {
      const v = await backgroundAuth(userId, tenant);
      if (!v) throw new Error('Year seed: a demo member cannot act');
      return v;
    };
    const summary: YearSummary = {
      members: 0,
      drives: 0,
      offers: 0,
      sessions: 0,
      referrals: 0,
      writeUps: 0,
      resumes: 0,
      mocks: 0,
      practiceSets: 0,
      events: 0,
    };

    // ── People ─────────────────────────────
    const people: Person[] = [];
    for (const b of BATCHES) {
      for (let n = 0; n < b.size; n++) {
        const nn = String(n + 1).padStart(2, '0');
        const yy = String(b.gradYear % 100);
        const label = b.role === 'ALUMNI' ? 'Alumnus' : 'Student';
        const name = `Demo ${label} ${yy}-${nn}`;
        const email = `demo.${label.toLowerCase()}.${yy}${nn}@${ctx.domain}`;
        const branch = b.mix[n % b.mix.length] as Branch;
        const roll = `${String((b.gradYear - 4) % 100)}${ctx.prefix}1A9${yy.slice(1)}${nn}`;
        const userId = await ctx.addUser(email, name, [b.role]);
        await WhitelistModel.create({
          rollNumber: roll,
          name,
          branch,
          gradYear: b.gradYear,
          kind: b.role === 'ALUMNI' ? 'alumni' : 'student',
          source: 'manual',
          emailEnc: ctx.cipher.encrypt(email),
          emailIndex: ctx.cipher.blindIndex(email),
          status: 'claimed',
          claimedBy: userId,
          claimedAt: at(330 - n),
        });
        people.push({
          id: userId,
          name,
          email,
          branch,
          gradYear: b.gradYear,
          role: b.role,
          roll,
          placed: null,
        });
      }
    }
    summary.members = people.length;
    const batch = (y: number) => people.filter((p) => p.gradYear === y);
    // Academic records (B7, read by readiness and drive eligibility) for the two batches in college.
    for (const p of [...batch(2027), ...batch(2028)]) {
      const i = people.indexOf(p);
      await AcademicRecordModel.create({
        rollNumber: p.roll,
        userId: p.id,
        cgpa: Math.round((6.2 + rand.next() * 3.2) * 10) / 10,
        activeBacklogs: i % 9 === 4 ? 1 : 0,
        historyBacklogs: i % 5 === 2 ? 1 : 0,
        tenthPct: rand.int(72, 96),
        twelfthPct: rand.int(68, 95),
        source: 'import',
        verifiedBy: id('tpo'),
        verifiedAt: at(300),
      });
    }

    // ── Placement seasons ─────────────────────────────
    const companies = await Promise.all(
      COMPANIES.map(async (c) => {
        const doc = await PlacementCompanyModel.findOne({ companyKey: companyKey(c.name) }).lean();
        if (!doc) throw new Error(`Year seed: company ${c.name} is missing (base seed)`);
        return doc;
      }),
    );
    const rounds = (start: Date) => [
      { name: 'Online assessment', kind: 'aptitude', at: start },
      { name: 'Technical interview', kind: 'technical', at: new Date(start.getTime() + 3 * 3600_000) },
      { name: 'HR interview', kind: 'hr', at: new Date(start.getTime() + 5 * 3600_000) },
    ];
    /** Results by position: the first SELECTED clear everything; then an HR miss; then three technical misses. */
    const resultsFor = (pos: number) => {
      if (pos < SELECTED) return { final: 'selected', cleared: 3 };
      if (pos === SELECTED) return { final: 'not_selected', cleared: 2 };
      if (pos < SELECTED + 4) return { final: 'not_selected', cleared: 1 };
      return { final: 'not_selected', cleared: 0 };
    };
    const seasonDrive = async (k: number, gradYear: number, daysAgo: number) => {
      const c = COMPANIES[k];
      const company = companies[k];
      if (!c || !company) throw new Error('Year seed: company index');
      const start = at(daysAgo, 4, 30);
      const drive = await PlacementDriveModel.create({
        companyId: company._id,
        title: `${c.role} campus drive, batch ${gradYear} (DEMO)`,
        description: 'DEMO drive at a fictional company: an online assessment, then two interviews.',
        roles: [
          {
            title: c.role,
            ctcMinLpa: c.ctc[0],
            ctcMaxLpa: c.ctc[1],
            location: 'Hyderabad',
            type: 'full_time',
          },
        ],
        mode: 'on_campus',
        venue: 'Seminar hall, block B',
        driveDate: start,
        registrationCloseAt: new Date(start.getTime() - 5 * DAY),
        eligibility: { branches: c.branches, gradYears: [gradYear], minCgpa: 6 },
        rounds: rounds(start),
        resumeRequired: false,
        status: 'completed',
        openedAt: new Date(start.getTime() - 15 * DAY),
        createdBy: id('tpo'),
      });
      summary.drives++;
      // Those still looking, in a rotating order so each drive meets a different mix.
      const pool = batch(gradYear)
        .filter((p) => !p.placed && (!c.branches.length || c.branches.includes(p.branch)))
        .sort((a, b) => ((people.indexOf(a) * 7 + k * 5) % 31) - ((people.indexOf(b) * 7 + k * 5) % 31))
        .slice(0, DRIVE_SIZE);
      const registrants: { person: Person; selected: boolean }[] = [];
      for (const [pos, p] of pool.entries()) {
        const r = resultsFor(pos);
        await DriveRegistrationModel.create({
          driveId: drive._id,
          userId: p.id,
          status: 'registered',
          final: r.final,
          roundResults: [0, 1, 2]
            .slice(0, Math.min(3, r.cleared + 1))
            .map((round) => ({ round, result: round < r.cleared ? 'cleared' : 'not_cleared' })),
          branch: p.branch,
          gradYear,
        });
        if (r.final === 'selected') {
          const ctc = Math.round((c.ctc[0] + rand.next() * (c.ctc[1] - c.ctc[0])) * 2) / 2;
          const verifiedAt = new Date(start.getTime() + 6 * DAY);
          const offer = await OfferModel.create({
            userId: p.id,
            companyKey: companyKey(c.name),
            companyName: c.name,
            role: c.role,
            ctcLpa: ctc,
            ctcBand: ctcBand(ctc),
            offerDate: new Date(start.getTime() + 2 * DAY),
            type: 'full_time',
            source: 'drive',
            driveId: drive._id,
            status: 'verified',
            verifiedBy: id('tpo'),
            verifiedAt,
            branch: p.branch,
            gradYear,
          });
          p.placed = { company: k, offerId: offer._id, ctc, at: verifiedAt };
          summary.offers++;
        }
        registrants.push({ person: p, selected: r.final === 'selected' });
      }
      return { drive, registrants, start };
    };
    // Two seasons ago (batch 2025), last season (batch 2026), this season so far (batch 2027), on
    // the same calendar each year so "the previous batch at the same point" compares like with like.
    for (const [k, d] of [800, 775, 755].entries()) await seasonDrive(k, 2025, d);
    for (const [k, d] of [435, 410, 390].entries()) await seasonDrive(k, 2026, d);
    const thisSeason: Awaited<ReturnType<typeof seasonDrive>>[] = [];
    for (const [k, d] of [70, 45, 25].entries()) thisSeason.push(await seasonDrive(k, 2027, d));

    // The placed alumni now work there (profile company, shown to members: "alumni there").
    for (const p of [...batch(2025), ...batch(2026)]) {
      const c = p.placed ? COMPANIES[p.placed.company] : null;
      await ProfileModel.create({
        userId: p.id,
        name: p.name,
        roles: [p.role],
        verified: true,
        branch: p.branch,
        gradYear: p.gradYear,
        headline: c ? `DEMO: ${c.role} at ${c.name}` : 'DEMO: alumnus',
        company: c?.name ?? '',
        jobTitle: c?.role ?? '',
        skills: c ? [c.topic, 'Communication'] : [],
        topics: c ? [c.topic, 'Interview prep'] : [],
        languages: ['Telugu', 'English'],
      });
    }
    for (const p of [...batch(2027), ...batch(2028)])
      await ProfileModel.create({
        userId: p.id,
        name: p.name,
        roles: [p.role],
        verified: true,
        branch: p.branch,
        gradYear: p.gradYear,
        headline: `DEMO: ${p.gradYear === 2027 ? 'final-year' : 'third-year'} ${p.branch}`,
        skills: ['Java', 'SQL'],
      });
    // The open drives of the base seed: some of this year's final-years have registered.
    const openDrives = await PlacementDriveModel.find({ status: 'open' }).lean();
    for (const d of openDrives) {
      const branches = (d.eligibility?.branches ?? []) as Branch[];
      const eligible = batch(2027).filter(
        (p) => !p.placed && (!branches.length || branches.includes(p.branch)),
      );
      for (const p of eligible.slice(0, Math.ceil(eligible.length * 0.6)))
        await DriveRegistrationModel.create({
          driveId: d._id,
          userId: p.id,
          status: 'registered',
          branch: p.branch,
          gradYear: 2027,
        });
    }

    // ── Mentors, sessions and referrals ─────────────────────────────
    const alumniAt = (k: number, y: number) => batch(y).filter((p) => p.placed?.company === k);
    const mentors = COMPANIES.map((_, k) => alumniAt(k, 2025).slice(0, 5));
    for (const p of mentors.flat()) {
      await MentorProfileModel.create({
        userId: p.id,
        accepting: true,
        weeklyCap: 4,
        audience: 'students',
        sessionTypes: [
          { type: 'quick_chat', enabled: true, durationMin: 0 },
          { type: 'video_1on1', enabled: true, durationMin: 30 },
          { type: 'mock_interview', enabled: true, durationMin: 45 },
          { type: 'resume_review', enabled: true, durationMin: 30 },
        ],
        minNoticeHours: 12,
        horizonDays: 30,
        bufferMin: 15,
        timezone: 'Asia/Kolkata',
        weekly: [1, 3, 5].map((day) => ({ day, windows: [{ start: '19:00', end: '21:00' }] })),
        exceptions: [],
      });
    }
    const referrers = COMPANIES.map((_, k) => [...alumniAt(k, 2026), ...alumniAt(k, 2025)]);
    await ReferralPrefsModel.insertMany(
      referrers
        .flat()
        .map((p) => ({ userId: p.id, accepting: true, weeklyCap: 3, note: 'DEMO: happy to refer juniors' })),
    );

    const events: {
      day: string;
      userId: Types.ObjectId;
      name: ProductEventName;
      props: Record<string, string>;
    }[] = [];
    const ev = (
      d: Date,
      userId: Types.ObjectId,
      name: ProductEventName,
      props: Record<string, string> = {},
    ) => events.push({ day: d.toISOString().slice(0, 10), userId, name, props });

    /** A request, accepted after `replyHours`, with a completed session `daysLater` and feedback. */
    const session = async (
      mentor: Person,
      mentee: Person,
      sentDaysAgo: number,
      replyHours: number,
      hourUtc: number,
      outcome: 'completed' | 'declined' | 'expired',
    ) => {
      const sent = at(sentDaysAgo, 6);
      const req = await MentorshipRequestModel.create({
        mentorId: mentor.id,
        menteeId: mentee.id,
        sessionType: outcome === 'completed' && sentDaysAgo % 2 ? 'mock_interview' : 'video_1on1',
        goal: 'DEMO: get ready for this placement season',
        background: `DEMO: ${mentee.branch} student, batch ${mentee.gradYear}`,
        need: 'DEMO: a practice round and honest feedback',
        status: outcome === 'completed' ? 'accepted' : outcome,
        respondedAt: outcome === 'expired' ? null : new Date(sent.getTime() + replyHours * 3600_000),
        expiresAt: new Date(sent.getTime() + 7 * DAY),
      });
      await MentorshipRequestModel.updateOne(
        { _id: req._id },
        { $set: { createdAt: sent } },
        { timestamps: false, overwriteImmutable: true },
      );
      const requestId = String(req._id);
      ev(sent, mentee.id, 'request_sent', { requestId });
      if (outcome !== 'expired')
        ev(new Date(sent.getTime() + replyHours * 3600_000), mentor.id, 'request_answered', { requestId });
      if (outcome !== 'completed') return;
      const start = at(sentDaysAgo - 4, hourUtc, 30);
      const end = new Date(start.getTime() + 30 * 60_000);
      const booking = await BookingModel.create({
        requestId: req._id,
        mentorId: mentor.id,
        menteeId: mentee.id,
        participants: [mentor.id, mentee.id],
        sessionType: 'video_1on1',
        start,
        end,
        status: 'completed',
        completedAt: end,
        holds: holdsFor(String(mentor.id), String(mentee.id), start, end, 15),
        room: randomRoomName(),
      });
      await MentorshipRequestModel.updateOne(
        { _id: req._id },
        { $set: { bookingId: booking._id, slotStart: start } },
        { timestamps: false },
      );
      await FeedbackModel.create({
        bookingId: booking._id,
        mentorId: mentor.id,
        menteeId: mentee.id,
        rating: rand.chance(0.7) ? 5 : 4,
        tags: ['clear_advice', 'actionable'],
        comment: 'DEMO: practical and kind.',
      });
      ev(end, mentee.id, 'session_completed', { requestId });
      summary.sessions++;
    };
    // Before this season's drives: each company's mentors met the students who later sat its drive.
    for (const [k, season] of thisSeason.entries()) {
      const ms = mentors[k] ?? [];
      for (const [i, r] of season.registrants.slice(0, 8).entries()) {
        const m = ms[i % ms.length];
        if (!m) continue;
        const daysBefore = Math.round((now - season.start.getTime()) / DAY) + 20 + i * 2;
        await session(m, r.person, daysBefore, 2 + ((i * 5) % 30), 12, 'completed');
      }
    }
    // Through the year: one request a fortnight from a junior, accepted (most), declined or left to expire.
    const juniors = [...batch(2027), ...batch(2028)];
    for (let w = 0; w < 26; w++) {
      const mentee = juniors[(w * 7) % juniors.length];
      const m = mentors[w % 3]?.[(w * 3) % 5];
      if (!mentee || !m) continue;
      const outcome = w % 5 === 3 ? 'declined' : w % 7 === 5 ? 'expired' : 'completed';
      await session(m, mentee, 14 * w + 9, 1 + ((w * 11) % 40), 14, outcome);
    }

    // Referrals: students asked alumni at each company; outcomes as the students reported them.
    const OUTCOMES = [
      'interview',
      'interview',
      'offer',
      'rejected',
      'no_response',
      'interview',
      'rejected',
    ] as const;
    for (const [k, c] of COMPANIES.entries()) {
      const poster = referrers[k]?.[0];
      if (!poster) continue;
      const expiresAt = at(-20);
      const job = await JobModel.create({
        origin: 'posted',
        postedBy: poster.id,
        title: `DEMO: ${c.role} (referral opening)`,
        company: c.name,
        companyKey: companyKey(c.name),
        location: 'Hyderabad',
        mode: 'hybrid',
        type: 'full_time',
        level: 'fresher',
        skills: [c.topic],
        skillKeys: [c.topic.toLowerCase()],
        branches: [],
        salary: null,
        applyUrl: `https://example.com/demo-careers/${companyKey(c.name)}-referral`,
        description: 'DEMO listing for trying referrals. Fictional company and role.',
        freshersOk: true,
        postedAt: at(150),
        expiresAt,
        dedupeKey: `posted-seed-year-${companyKey(c.name)}`,
        purgeAt: new Date(expiresAt.getTime() + 60 * DAY),
      });
      const askers = batch(2027)
        .filter((p) => p.placed?.company !== k)
        .slice(k * 3, k * 3 + OUTCOMES.length);
      for (const [i, p] of askers.entries()) {
        const referrer = referrers[k]?.[i % (referrers[k]?.length ?? 1)];
        const outcome = OUTCOMES[i];
        if (!referrer || !outcome) continue;
        const created = at(140 - k * 10 - i * 3);
        const respondedAt = new Date(created.getTime() + (6 + i * 4) * 3600_000);
        const outcomeAt = new Date(created.getTime() + 21 * DAY);
        const r = await ReferralRequestModel.create({
          requesterId: p.id,
          referrerId: referrer.id,
          jobId: job._id,
          jobTitle: job.title,
          company: c.name,
          why: 'DEMO: I have practised for this role and would love a referral.',
          status: 'referred',
          respondedAt,
          expiresAt: new Date(created.getTime() + 14 * DAY),
          outcome,
          outcomeAt,
        });
        await ReferralRequestModel.updateOne(
          { _id: r._id },
          { $set: { createdAt: created } },
          { timestamps: false, overwriteImmutable: true },
        );
        ev(outcomeAt, p.id, 'referral_outcome_reported', { outcome });
        summary.referrals++;
      }
    }

    // ── Interview write-ups (G10) ─────────────────────────────
    for (const [k, c] of COMPANIES.entries()) {
      const authors = alumniAt(k, 2026).slice(0, 3);
      for (const [i, p] of authors.entries()) {
        await ExperienceModel.create({
          authorId: p.id,
          companyKey: companyKey(c.name),
          companyName: c.name,
          role: c.role,
          year: p.placed?.at.getUTCFullYear() ?? 2025,
          rounds: ['aptitude', 'technical', 'hr'].map(writeUpRound),
          tips: 'DEMO tip: practise speaking through your approach; revise one project end to end.',
          difficulty: (['easy', 'medium', 'hard'] as const)[i % 3],
          result: 'selected',
          named: i !== 1,
          basis: 'verified_offer',
          branch: p.branch,
          gradYear: p.gradYear,
          status: 'published',
          reviewedBy: id('tpo'),
          reviewedAt: at(200 - i),
        });
        summary.writeUps++;
      }
    }
    // One waiting in Admin › Interview write-ups, from this season.
    const fresh = thisSeason[0]?.registrants.find((r) => r.selected)?.person;
    if (fresh) {
      const c0 = COMPANIES[0];
      await ExperienceModel.create({
        authorId: fresh.id,
        companyKey: companyKey(c0.name),
        companyName: c0.name,
        role: c0.role,
        year: fresh.placed?.at.getUTCFullYear() ?? 2026,
        rounds: ['aptitude', 'technical'].map(writeUpRound),
        tips: 'DEMO tip: the assessment is timed tightly; skip and come back.',
        difficulty: 'medium',
        result: 'selected',
        named: true,
        basis: 'verified_offer',
        branch: fresh.branch,
        gradYear: fresh.gradYear,
        status: 'pending',
      });
      summary.writeUps++;
    }

    // ── Career readiness through the real services (G2, G3, G4; mock AI) ─────────────────────────────
    const finalYears = batch(2027);
    const nimbusOpen = openDrives.find((d) => String(d.companyId) === String(companies[0]?._id));
    for (const [i, p] of finalYears.slice(0, 14).entries()) {
      const v = await auth(p.id);
      const r = await s.resumes.create(v, resumeCreateBody.parse({ title: `DEMO résumé ${i + 1}` }));
      await s.resumes.ats(
        v,
        r.id,
        atsCheckBody.parse(
          nimbusOpen && i % 2 === 0 ? { driveId: String(nimbusOpen._id) } : { jobDescription: JD },
        ),
      );
      summary.resumes++;
      // An alumnus reviewed half of them (section comments, as in a résumé review request).
      if (i % 2 === 1) {
        const reviewer = mentors[i % 3]?.[0];
        if (reviewer) {
          await ResumeCommentModel.create({
            resumeId: new Types.ObjectId(r.id),
            resumeVersion: r.version,
            authorId: reviewer.id,
            section: 'projects',
            body: 'DEMO review: lead each project with what you built and the result, in one line.',
          });
          ev(at(0), p.id, 'resume_reviewed');
        }
      }
    }
    await jobs.drain();
    for (const [i, p] of finalYears.slice(2, 14).entries()) {
      const v = await auth(p.id);
      const track = i % 3 === 2 ? 'technical' : 'hr';
      let m = await s.interviews.create(v, interviewCreateBody.parse({ track, questions: 5 }));
      while (m.current !== null) m = await s.interviews.answer(v, m.id, { turn: m.current, text: ANSWER });
      if (m.status !== 'completed') await s.interviews.finish(v, m.id);
      summary.mocks++;
    }
    for (const p of [...finalYears.slice(0, 16), ...batch(2028).slice(0, 6)]) {
      const v = await auth(p.id);
      await s.practice.home(v);
      const set = await s.practice.start(v, {});
      for (const it of set.items) {
        const right = rand.chance(0.65);
        const opts = it.item.options;
        await s.practice.answer(v, set.id, {
          index: it.index,
          answer: opts.length ? (opts[right ? 0 : opts.length - 1] ?? '') : '',
        });
      }
      summary.practiceSets++;
    }
    await jobs.drain();

    // ── Alumni engagement (G6) ─────────────────────────────
    for (const m of mentors.flat()) await s.microAsks.setOpen(await auth(m.id), true);
    for (const [i, p] of finalYears.slice(16, 22).entries()) {
      const c = COMPANIES[i % 3];
      if (!c) continue;
      const ask = await s.microAsks.create(
        await auth(p.id),
        microAskBody.parse({
          kind: i % 2 ? 'feedback_on_project' : 'quick_intro',
          audience: { company: c.name },
          note: 'DEMO: ten minutes on whether my project shows the right skills for this role.',
        }),
      );
      const doc = await MicroAskModel.findById(ask.id).lean();
      if (doc?.toUserId && i < 4) {
        const alumnus = await auth(doc.toUserId);
        await s.microAsks.reply(alumnus, ask.id, 'accept');
        await s.microAsks.reply(alumnus, ask.id, 'done');
      }
    }
    const host = mentors[0]?.[0];
    if (host) {
      const first = at(-3, 13, 30);
      await s.events.create(
        await auth(host.id),
        eventBody.parse({
          title: 'DEMO office hours: backend interviews',
          description: 'DEMO: drop in with one question about backend interviews. Fictional host.',
          kind: 'office_hours',
          mode: 'online',
          startsAt: first.toISOString(),
          endsAt: new Date(first.getTime() + 3600_000).toISOString(),
          onlineUrl: 'https://meet.example.com/demo-office-hours',
          audience: 'students',
          recurrence: { weekly: true, until: new Date(first.getTime() + 12 * 7 * DAY).toISOString() },
        }),
        meta,
      );
      for (const p of finalYears.slice(0, 8))
        await s.events.subscribe(await auth(p.id), String(host.id), true);
    }
    for (const m of mentors.map((ms) => ms[0]).filter((x): x is Person => !!x))
      await s.recognition.issue(await auth(m.id), academicYearOf(new Date()));
    await jobs.drain();

    // ── Habit loops (G7) ─────────────────────────────
    const tpo = await auth(id('tpo'));
    const circle = await s.circles.create(
      tpo,
      circleBody.parse({
        name: 'Placement prep 2027 (demo)',
        kind: 'batch',
        gradYear: 2027,
        description:
          'DEMO circle for this year’s final-years: prep plans, mock partners and drive reminders.',
      }),
    );
    for (const p of finalYears.slice(0, 18)) await s.circles.join(await auth(p.id), circle.id);
    for (const p of finalYears.filter((x) => x.placed).slice(0, 3))
      await s.peers.setPeer(await auth(p.id), true);
    await s.nextStep.run({ tenantId: String(ctx.tenantId), week: isoWeek(new Date()) });

    // ── Growth loops (G8) ─────────────────────────────
    const admin = await auth(id('admin'));
    await s.publicPages.setMemberInvites(admin, true, true, meta);
    await s.publicPages.setOutcomesPage(admin, true, meta);
    // Four classmates on the list who have not joined: one final-year invites them.
    for (let n = 0; n < 4; n++) {
      const phone = `+9190000${ctx.prefix === 'DP' ? '3' : '4'}00${String(n).padStart(2, '0')}`;
      await WhitelistModel.create({
        rollNumber: `23${ctx.prefix}1A98${String(n).padStart(2, '0')}`,
        name: `Demo Invitee 27-${String(n + 1).padStart(2, '0')}`,
        branch: 'CSE',
        gradYear: 2027,
        kind: 'student',
        source: 'manual',
        phoneEnc: ctx.cipher.encrypt(phone),
        phoneIndex: ctx.cipher.blindIndex(phone),
      });
    }
    const inviter = finalYears.find((p) => p.branch === 'CSE');
    if (inviter) await s.onboarding.inviteBatch(tenant, { userId: String(inviter.id) }, 4, 'member', meta);
    const proud = batch(2026).find((p) => p.placed);
    if (proud?.placed)
      await s.publicPages.publish(
        await auth(proud.id),
        publicPageBody.parse({ kind: 'placed', refId: String(proud.placed.offerId), nameStyle: 'first' }),
      );

    // ── The network (G12, ADR 0014 approved) ─────────────────────────────
    // Alumni discovery on (the admin accepts the network terms); the mentors and a few final-years
    // opt in to being found by students of other colleges. Employer access stays off by default.
    await s.network.setSwitches(admin, { alumniDiscovery: true, acceptTerms: true }, meta);
    for (const p of [...mentors.flat(), ...finalYears.slice(0, 6)])
      await s.network.setConsent(await auth(p.id), 'network_discovery', true, meta);

    // ── Copilot questions (G11; answered from the index after the graph run) are replayed below ──
    // ── 52 weeks of product events (track rules: adults with analytics consent only) ──
    // Two final-years withdrew the analytics consent: they record nothing (and their earlier events
    // are not invented for them).
    const withdrawn = finalYears.slice(-2);
    for (const p of withdrawn)
      await ConsentModel.create({
        userId: p.id,
        purpose: 'analytics_aggregate',
        version: 1,
        noticeVersion: PRIVACY_NOTICE_VERSION,
        granted: false,
        source: 'settings',
      });
    const quiet = new Set(withdrawn.map((p) => String(p.id)));
    const visitDays = new Map<string, Set<string>>();
    const visit = (d: Date, p: Person) => {
      const day = d.toISOString().slice(0, 10);
      const seen = visitDays.get(String(p.id)) ?? new Set<string>();
      if (seen.has(day)) return;
      seen.add(day);
      visitDays.set(String(p.id), seen);
      ev(d, p.id, 'visited');
    };
    for (const p of people) {
      if (quiet.has(String(p.id))) continue;
      const i = people.indexOf(p);
      const isStudent = p.role === 'STUDENT';
      // Joined in the first ten weeks of the year (the college's launch), then came back weekly.
      const joinedAgo = 360 - (i % 10) * 7 - (i % 3);
      ev(at(joinedAgo), p.id, 'signed_up', { source: 'demo' });
      ev(at(joinedAgo), p.id, 'verified');
      visit(at(joinedAgo), p);
      for (let w = Math.floor(joinedAgo / 7) - 1; w >= 0; w--) {
        // Busier in the placement season (July to December) and for final-years.
        const d = at(w * 7 + (i % 5) + 1, 10);
        const month = d.getUTCMonth();
        const season = month >= 6 && month <= 11;
        const p0 = isStudent ? (p.gradYear === 2027 ? 0.62 : 0.45) : 0.22;
        if (!rand.chance(p0 + (season ? 0.18 : 0) - (w > 40 ? 0.1 : 0))) continue;
        visit(d, p);
        if (!isStudent) continue;
        const roll = rand.next();
        if (roll < 0.35) ev(d, p.id, 'roadmap_step');
        else if (roll < 0.6) ev(d, p.id, 'study_question');
        if (rand.chance(0.35)) ev(d, p.id, 'practice_set_completed');
        if (season && p.gradYear === 2027 && rand.chance(0.3)) ev(d, p.id, 'company_page_viewed');
        if (p.gradYear === 2027 && w < 30 && rand.chance(0.25)) ev(d, p.id, 'copilot_question');
        if (w < 20 && rand.chance(0.3)) ev(d, p.id, 'next_step_opened');
      }
    }
    // Drive registrations of this season and the last, on their registration days.
    const regs = await DriveRegistrationModel.find({ gradYear: { $in: [2026, 2027] }, userId: { $ne: null } })
      .select('userId driveId')
      .lean();
    const driveDays = new Map(
      (await PlacementDriveModel.find().select('registrationCloseAt').lean()).map((d) => [
        String(d._id),
        d.registrationCloseAt,
      ]),
    );
    for (const r of regs) {
      const close = driveDays.get(String(r.driveId));
      if (!r.userId || !close || quiet.has(String(r.userId))) continue;
      const d = new Date(Math.min(close.getTime() - 2 * DAY, now - DAY));
      if (now - d.getTime() > 360 * DAY) continue;
      ev(d, r.userId, 'drive_registered', { driveId: String(r.driveId) });
    }
    for (const p of people)
      if (p.placed && now - p.placed.at.getTime() < 360 * DAY && !quiet.has(String(p.id)))
        ev(p.placed.at, p.id, 'offer_verified');
    const kept = events.filter(
      (e) => !quiet.has(String(e.userId)) && e.day <= at(0).toISOString().slice(0, 10),
    );
    await ProductEventModel.insertMany(
      kept.map((e) => ({ ...e, createdAt: new Date(`${e.day}T10:00:00Z`) })),
    );
    summary.events = kept.length;

    return summary;
  }

  /**
   * AI usage for the year, replayed from measured per-request tokens. Run after the graph and the
   * Career Copilot index are built. Three real Career Copilot questions and three real study
   * questions (the FLAT demo subject) go through the services with the mock provider (four
   * characters a token over the real prompts), next to the résumé and interview runs of `seedYear`.
   * Each seeded `copilot_question` and `study_question` of the past year then records its feature's
   * measured average on its own day and member, as the real services would have.
   */
  async function replayAi(ctx: Pick<YearContext, 'tenantId'>): Promise<{ requests: number }> {
    const tenant = await findTenantById(ctx.tenantId);
    if (!tenant) throw new Error('Year seed: the college is missing');
    const askers = await ProfileModel.find({ gradYear: 2027, name: /^Demo Student / })
      .sort({ name: 1 })
      .limit(3)
      .select('userId')
      .lean();
    for (const a of askers) {
      const v = await backgroundAuth(a.userId, tenant);
      if (!v) continue;
      const run = await s.copilot.prepare(v, { question: `How do the ${COMPANIES[0].name} interviews go?` });
      await run(() => undefined);
      const study = await s.chat.prepare(
        v,
        chatAskBody.parse({ question: 'What does the pumping lemma show?' }),
      );
      await study(() => undefined, new AbortController().signal);
    }
    const today = new Date().toISOString().slice(0, 10);
    // Per question: everything the askers' questions used today (the answer and the query embedding).
    const measured = await AiUsageModel.aggregate<{
      _id: { feature: string; kind: string; model: string; platform: boolean };
      requests: number;
      input: number;
      output: number;
    }>([
      {
        $match: {
          day: today,
          userId: { $in: askers.map((a) => a.userId) },
          feature: { $in: ['copilot', 'study_chat'] },
        },
      },
      {
        $group: {
          _id: { feature: '$feature', kind: '$kind', model: '$model', platform: '$platform' },
          requests: { $sum: '$requests' },
          input: { $sum: '$inputTokens' },
          output: { $sum: '$outputTokens' },
        },
      },
    ]);
    const asked = askers.length;
    let requests = 0;
    for (const [name, feature] of [
      ['copilot_question', 'copilot'],
      ['study_question', 'study_chat'],
    ] as const) {
      const units = measured
        .filter((m) => m._id.feature === feature && m.requests > 0)
        .map((m) => ({
          ...m._id,
          requests: Math.max(1, Math.round(m.requests / asked)),
          input: Math.round(m.input / asked),
          output: Math.round(m.output / asked),
        }));
      if (!units.length || !asked)
        throw new Error(`Year seed: no measured ${feature} request (is the demo assistant on?)`);
      const rows = await ProductEventModel.aggregate<{
        _id: { day: string; userId: Types.ObjectId };
        n: number;
      }>([
        { $match: { name, day: { $lt: today }, userId: { $ne: null } } },
        { $group: { _id: { day: '$day', userId: '$userId' }, n: { $sum: 1 } } },
      ]);
      // One upsert per member, day and kind (bulkWrite is refused in tenant context).
      for (const r of rows)
        for (const u of units) {
          await AiUsageModel.updateOne(
            {
              day: r._id.day,
              userId: r._id.userId,
              kind: u.kind,
              feature,
              platform: u.platform,
              model: u.model,
            },
            {
              $inc: {
                requests: r.n * u.requests,
                inputTokens: r.n * u.input,
                outputTokens: r.n * u.output,
              },
            },
            { upsert: true },
          );
          requests += r.n * u.requests;
        }
    }
    return { requests };
  }

  return { seedYear, replayAi };
}
