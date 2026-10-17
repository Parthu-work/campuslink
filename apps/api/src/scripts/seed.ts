/**
 * Local demo data. Every person and college here is FICTIONAL (CLAUDE.md: never invent real data).
 * Usage: pnpm seed   (drops and recreates the local development database)
 */
import mongoose, { type Types } from 'mongoose';
import {
  APP_NAME,
  CONSENT_PURPOSE_KEYS,
  type Role,
  type Capability,
  type Branding,
  type Branch,
} from '@campuslink/shared';
import { loadEnv } from '../config/env.js';
import { syncIndexes } from '../db/connect.js';
import { runInTenant } from '../lib/context.js';
import { hashPassword } from '../lib/passwords.js';
import { TenantModel } from '../modules/tenants/tenant.model.js';
import { UserModel } from '../modules/auth/user.model.js';
import { ConsentModel } from '../modules/consent/consent.model.js';
import { AuditModel } from '../modules/audit/audit.model.js';
import { ProfileModel } from '../modules/profiles/profile.model.js';
import { WhitelistModel } from '../modules/imports/whitelist.model.js';
import { FieldCipher } from '../lib/crypto.js';
import { MentorProfileModel } from '../modules/mentorship/mentor.model.js';
import { MentorshipRequestModel } from '../modules/mentorship/request.model.js';
import { BookingModel, FeedbackModel } from '../modules/sessions/booking.model.js';
import { ConversationModel, MessageModel } from '../modules/messaging/conversation.model.js';
import { holdsFor } from '../modules/mentorship/slots.js';
import { randomRoomName } from '../lib/video.js';
import { CommentModel, PostModel, ReactionModel } from '../modules/feed/post.model.js';
import { FollowModel, StoryModel } from '../modules/feed/story.model.js';
import { AnswerModel, QuestionModel } from '../modules/qa/question.model.js';
import { JobModel, SavedJobModel } from '../modules/jobs/job.model.js';
import { ReferralPrefsModel } from '../modules/referrals/referral.model.js';
import { companyKey } from '../lib/company.js';
import { installLibraryRoadmaps } from '../modules/roadmaps/roadmaps.service.js';
import { dayKey } from '../modules/gamification/gamification.service.js';
import {
  GamificationPrefsModel,
  RewardModel,
  UserBadgeModel,
  XpEventModel,
} from '../modules/gamification/gamification.model.js';
import { EventModel, EventRsvpModel } from '../modules/events/event.model.js';
import { XP_RULES, type XpKind } from '@campuslink/shared';
import {
  RoadmapModel,
  RoadmapProgressModel,
  RoadmapVersionModel,
} from '../modules/roadmaps/roadmap.model.js';

const env = loadEnv();
if (env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
const password = process.env.SEED_PASSWORD ?? 'Demo-Campus-Link-2026';
const cipher = new FieldCipher(env.FIELD_ENCRYPTION_KEY, env.FIELD_ENCRYPTION_KEYS_PREVIOUS);

const COLLEGES: { slug: string; branding: Branding; domain: string }[] = [
  {
    slug: 'dpit',
    domain: 'dpit.example',
    branding: {
      displayName: 'Deccan Plateau Institute of Technology',
      shortName: 'DPIT',
      primary: '#3fb8e6',
      secondary: '#6d5ae6',
      accent: '#f2b705',
      monogram: 'DP',
      city: 'Hyderabad (demo)',
    },
  },
  {
    slug: 'mrce',
    domain: 'mrce.example',
    branding: {
      displayName: 'Musi Riverfront College of Engineering',
      shortName: 'MRCE',
      primary: '#22b07d',
      secondary: '#0e7c86',
      accent: '#ff7a59',
      monogram: 'MR',
      city: 'Hyderabad (demo)',
    },
  },
];

type SeedUser = {
  local: string;
  name: string;
  roles: Role[];
  verified?: boolean;
  capabilities?: Capability[];
  /** College-list record (roll number, graduation year, branch). Staff have none. */
  roll?: { no: string; gradYear: number; branch: Branch };
  profile?: {
    headline?: string;
    company?: string;
    jobTitle?: string;
    skills?: string[];
    topics?: string[];
    languages?: string[];
  };
};
// Fictional demo people and companies (CLAUDE.md: never real people or listings).
const PEOPLE: SeedUser[] = [
  { local: 'admin', name: 'Kavya Iyer', roles: ['COLLEGE_ADMIN'] },
  {
    local: 'tpo',
    name: 'Srinivas Murthy',
    roles: ['TPO'],
    profile: { headline: 'Training & Placement Officer' },
  },
  {
    local: 'faculty',
    name: 'Dr. Haritha Rao',
    roles: ['FACULTY'],
    profile: { headline: 'Associate Professor, CSE', topics: ['Higher studies', 'GATE'] },
  },
  {
    local: 'rahul',
    name: 'Rahul Varma',
    roles: ['ALUMNI'],
    roll: { no: '15XX1A0512', gradYear: 2019, branch: 'CSE' },
    profile: {
      headline: 'Backend engineer · mock interviews',
      company: 'Nimbus Labs (demo)',
      jobTitle: 'SDE II',
      skills: ['Java', 'System design', 'DSA'],
      topics: ['Backend', 'Interview prep'],
      languages: ['Telugu', 'English'],
    },
  },
  {
    local: 'sneha',
    name: 'Sneha Reddy',
    roles: ['ALUMNI'],
    roll: { no: '16XX1A0433', gradYear: 2020, branch: 'ECE' },
    profile: {
      headline: 'ECE → data analytics',
      company: 'Kestrel Analytics (demo)',
      jobTitle: 'Data Analyst',
      skills: ['SQL', 'Python', 'Power BI'],
      topics: ['Core to IT switch', 'Data'],
      languages: ['Telugu', 'English', 'Hindi'],
    },
  },
  {
    local: 'fatima',
    name: 'Fatima Begum',
    roles: ['ALUMNI'],
    roll: { no: '16XX1A0507', gradYear: 2020, branch: 'CSE' },
    profile: {
      headline: 'ML engineer · monthly AMAs',
      company: 'Northstar AI (demo)',
      jobTitle: 'ML Engineer',
      skills: ['Python', 'PyTorch', 'MLOps'],
      topics: ['ML & AI', 'Research'],
      languages: ['Urdu', 'English', 'Telugu'],
    },
  },
  {
    local: 'arjun',
    name: 'Arjun Naidu',
    roles: ['ALUMNI'],
    roll: { no: '14XX1A0301', gradYear: 2018, branch: 'MECH' },
    profile: {
      headline: 'Design engineer · GATE & PSU guidance',
      company: 'Ironleaf Motors (demo)',
      jobTitle: 'Design Engineer',
      skills: ['CATIA', 'GD&T', 'FEA'],
      topics: ['GATE', 'Core jobs'],
      languages: ['Telugu', 'English'],
    },
  },
  {
    local: 'ananya',
    name: 'Ananya K',
    roles: ['STUDENT'],
    roll: { no: '23XX1A0542', gradYear: 2027, branch: 'CSE' },
    profile: { headline: 'Third-year CSE · backend', skills: ['Java', 'Git'] },
  },
  {
    local: 'vikram',
    name: 'Vikram Shetty',
    roles: ['STUDENT'],
    capabilities: ['CERTIFIED_CONTRIBUTOR'],
    roll: { no: '22XX1A0519', gradYear: 2026, branch: 'CSE' },
    profile: { headline: 'Final-year CSE · roadmap contributor', skills: ['React', 'Node.js'] },
  },
  { local: 'newbie', name: 'Sai Teja', roles: ['STUDENT'], verified: false },
];

/** Unclaimed list records: `newbie` can verify with the first one (code goes to Mailpit). */
const UNCLAIMED: { no: string; name: string; gradYear: number; branch: Branch; localEmail: string }[] = [
  { no: '24XX1A0577', name: 'Sai Teja', gradYear: 2028, branch: 'CSE', localEmail: 'sai.teja.records' },
  { no: '24XX1A0578', name: 'Lavanya P', gradYear: 2028, branch: 'IT', localEmail: 'lavanya.records' },
  { no: '13XX1A0201', name: 'Prakash Goud', gradYear: 2017, branch: 'EEE', localEmail: 'prakash.records' },
];

async function addUser(
  email: string,
  name: string,
  roles: Role[],
  hash: string,
  extra: { verified?: boolean; capabilities?: Capability[] } = {},
): Promise<Types.ObjectId> {
  const u = await UserModel.create({
    email,
    name,
    passwordHash: hash,
    roles,
    capabilities: extra.capabilities ?? [],
    verified: extra.verified ?? true,
    emailVerifiedAt: new Date(),
    ageDeclaredAt: new Date(),
  });
  await ConsentModel.insertMany(
    CONSENT_PURPOSE_KEYS.map((purpose) => ({
      userId: u._id,
      purpose,
      version: 1,
      noticeVersion: 'seed',
      granted: true,
      source: 'signup',
    })),
  );
  return u._id;
}

const DAY = 24 * 3600_000;
const evenings = [1, 2, 3, 4, 5].map((day) => ({ day, windows: [{ start: '18:00', end: '21:00' }] }));
const weekend = [0, 6].map((day) => ({ day, windows: [{ start: '10:00', end: '13:00' }] }));
const TYPES = [
  { type: 'quick_chat', enabled: true, durationMin: 0 },
  { type: 'video_1on1', enabled: true, durationMin: 30 },
  { type: 'mock_interview', enabled: true, durationMin: 45 },
  { type: 'resume_review', enabled: true, durationMin: 30 },
];

/** Demo mentorship data: fictional people, fictional conversations, clearly labelled as demo. */
async function seedMentorship(ids: Map<string, Types.ObjectId>) {
  const id = (local: string) => {
    const v = ids.get(local);
    if (!v) throw new Error(`seed: missing ${local}`);
    return v;
  };
  for (const local of ['rahul', 'sneha', 'fatima', 'arjun']) {
    await MentorProfileModel.create({
      userId: id(local),
      accepting: true,
      weeklyCap: 5,
      audience: local === 'arjun' ? 'students' : 'both',
      sessionTypes: TYPES,
      minNoticeHours: 4,
      horizonDays: 30,
      bufferMin: 15,
      timezone: 'Asia/Kolkata',
      // Fatima mentors around the clock in the demo so every slot test finds free times.
      weekly:
        local === 'fatima'
          ? [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, windows: [{ start: '00:00', end: '24:00' }] }))
          : [...evenings, ...weekend],
      exceptions: [],
    });
  }
  const pair = async (
    mentor: string,
    mentee: string,
    sessionType: string,
    opts: { status?: string; respondedAt?: Date } = {},
  ) =>
    MentorshipRequestModel.create({
      mentorId: id(mentor),
      menteeId: id(mentee),
      sessionType,
      goal: 'DEMO: get ready for backend interviews this placement season',
      background: 'DEMO: third-year CSE student, comfortable with Java and SQL',
      need: 'DEMO: a mock system-design round and honest feedback',
      status: opts.status ?? 'accepted',
      respondedAt: opts.respondedAt ?? new Date(),
      expiresAt: new Date(Date.now() + 7 * DAY),
    });

  // Ananya ↔ Rahul: an accepted mentorship with a short demo chat and a session that starts soon
  // (so "Join video" can be tried right after seeding).
  const req = await pair('rahul', 'ananya', 'mock_interview');
  const conv = await ConversationModel.create({
    participants: [id('rahul'), id('ananya')],
    pairKey: [String(id('rahul')), String(id('ananya'))].sort().join('|'),
    lastMessageAt: new Date(),
  });
  const lines: [string, string][] = [
    ['ananya', 'DEMO: Hi Rahul! Thanks for accepting. I shared my goal in the request.'],
    ['rahul', 'DEMO: Happy to help, Ananya. Bring one system you have designed and we will go through it.'],
    ['ananya', 'DEMO: Great, I will prepare the library-management project.'],
  ];
  for (const [who, text] of lines)
    await MessageModel.create({ conversationId: conv._id, senderId: id(who), bodyEnc: cipher.encrypt(text) });
  // Starts in 5 minutes, so the join window (10 minutes before the start) is already open.
  const soon = new Date(Math.floor((Date.now() + 5 * 60_000) / 60_000) * 60_000);
  const soonEnd = new Date(soon.getTime() + 60 * 60_000);
  const booking = await BookingModel.create({
    requestId: req._id,
    mentorId: id('rahul'),
    menteeId: id('ananya'),
    participants: [id('rahul'), id('ananya')],
    sessionType: 'mock_interview',
    start: soon,
    end: soonEnd,
    holds: holdsFor(String(id('rahul')), String(id('ananya')), soon, soonEnd, 15),
    room: randomRoomName(),
    conversationId: conv._id,
  });
  await MentorshipRequestModel.updateOne(
    { _id: req._id },
    { $set: { bookingId: booking._id, slotStart: soon, conversationId: conv._id } },
  );

  // A past session with feedback, so Rahul's impact card is not empty.
  const past = await pair('rahul', 'vikram', 'resume_review');
  const pastStart = new Date(Date.now() - 3 * DAY);
  const pastBooking = await BookingModel.create({
    requestId: past._id,
    mentorId: id('rahul'),
    menteeId: id('vikram'),
    participants: [id('rahul'), id('vikram')],
    sessionType: 'resume_review',
    start: pastStart,
    end: new Date(pastStart.getTime() + 30 * 60_000),
    status: 'completed',
    completedAt: new Date(pastStart.getTime() + 30 * 60_000),
    holds: holdsFor(
      String(id('rahul')),
      String(id('vikram')),
      pastStart,
      new Date(pastStart.getTime() + 30 * 60_000),
      15,
    ),
    room: randomRoomName(),
  });
  await FeedbackModel.create({
    bookingId: pastBooking._id,
    mentorId: id('rahul'),
    menteeId: id('vikram'),
    rating: 5,
    tags: ['clear_advice', 'actionable'],
    comment: 'DEMO: very practical resume feedback.',
  });
  await ConversationModel.create({
    participants: [id('rahul'), id('vikram')],
    pairKey: [String(id('rahul')), String(id('vikram'))].sort().join('|'),
  });

  // A pending request waiting in Fatima's inbox.
  await pair('fatima', 'vikram', 'quick_chat', { status: 'pending' });
}

/**
 * Demo feed: posts, a poll, an announcement, a story and Q&A, every text marked DEMO. No news items
 * are seeded: real feeds come only from sources an admin adds (never invented headlines).
 */
async function seedFeed(ids: Map<string, Types.ObjectId>) {
  const id = (local: string) => {
    const v = ids.get(local);
    if (!v) throw new Error(`seed: missing ${local}`);
    return v;
  };
  const ago = (h: number) => new Date(Date.now() - h * 3600_000);
  const post = async (
    author: string,
    hoursAgo: number,
    fields: Record<string, unknown>,
    facts: { alumni: boolean; branch: Branch | null },
  ) => {
    const p = await PostModel.create({
      authorId: id(author),
      kind: 'text',
      authorAlumni: facts.alumni,
      authorBranch: facts.branch,
      ...fields,
    });
    await PostModel.updateOne({ _id: p._id }, { $set: { createdAt: ago(hoursAgo) } }, { timestamps: false });
    return p._id;
  };
  const tip = await post(
    'rahul',
    3,
    {
      body: 'DEMO: One habit that helped me crack backend interviews:\n\n- Solve **one** problem a day, but explain it out loud\n- Re-do it a week later without notes\n\n#placements #dsa',
      hashtags: ['placements', 'dsa'],
      topics: ['placements', 'dsa'],
      counts: { helpful: 2, insightful: 0, celebrate: 0, comments: 1, saves: 0, shares: 0 },
    },
    { alumni: true, branch: 'CSE' },
  );
  await ReactionModel.insertMany([
    { postId: tip, userId: id('ananya'), reaction: 'helpful' },
    { postId: tip, userId: id('vikram'), reaction: 'helpful' },
  ]);
  await CommentModel.create({
    postId: tip,
    authorId: id('ananya'),
    body: 'DEMO: Trying this from today. Do you time yourself while explaining?',
  });
  await post(
    'fatima',
    6,
    {
      kind: 'poll',
      body: 'DEMO: Final-years, what are you preparing for first?',
      topics: ['placements', 'higher-studies'],
      poll: {
        options: [
          { text: 'Campus placements', votes: 0 },
          { text: 'GATE', votes: 0 },
          { text: 'Higher studies abroad', votes: 0 },
        ],
        closesAt: new Date(Date.now() + 3 * DAY),
      },
    },
    { alumni: true, branch: null },
  );
  await post(
    'tpo',
    20,
    {
      body: 'DEMO: Placement cell office hours move to 3–5 pm this week. Bring printed resumes for the mock drive.',
      announcement: true,
      topics: ['placements', 'events'],
    },
    { alumni: false, branch: null },
  );
  await post(
    'arjun',
    30,
    {
      body: 'DEMO: Core-company interviews still ask fundamentals. Revise *thermodynamics* and *strength of materials* before the aptitude round.',
      topics: ['core-jobs', 'mechanical'],
    },
    { alumni: true, branch: null },
  );
  await StoryModel.create({
    authorId: id('tpo'),
    kind: 'text',
    text: 'DEMO: Mock interview slots open today in the seminar hall',
    background: 'ocean',
    expiresAt: new Date(Date.now() + 20 * 3600_000),
  });
  const q = await QuestionModel.create({
    authorId: id('ananya'),
    title: 'DEMO: How many projects should a CSE resume show for backend roles?',
    body: 'DEMO: Third year, two projects so far.',
    topics: ['placements'],
    status: 'published',
    answers: 1,
  });
  const a = await AnswerModel.create({
    questionId: q._id,
    authorId: id('rahul'),
    body: 'DEMO: Two solid projects you can explain end to end beat five shallow ones.',
  });
  await QuestionModel.updateOne({ _id: q._id }, { $set: { acceptedAnswerId: a._id } });
  await QuestionModel.create({
    authorId: id('vikram'),
    title: 'DEMO: Is GATE worth it if I already have a campus offer?',
    topics: ['gate'],
  });
  await FollowModel.create({ followerId: id('ananya'), targetType: 'user', targetId: String(id('rahul')) });
}

/**
 * Demo openings posted by the fictional alumni and TPO at fictional companies, marked DEMO, with
 * apply links on the reserved example.com domain. Real listings come only from sources an admin adds.
 */
/** The researched library, plus DEMO progress and one DEMO draft waiting for review. */
async function seedRoadmaps(ids: Map<string, Types.ObjectId>) {
  const id = (local: string) => {
    const v = ids.get(local);
    if (!v) throw new Error(`seed: missing ${local}`);
    return v;
  };
  await installLibraryRoadmaps();
  const sde = await RoadmapModel.findOne({ libraryKey: 'sde-dsa' }).lean();
  const sdeV = sde
    ? await RoadmapVersionModel.findOne({ roadmapId: sde._id, version: 1 }).lean<{
        content: { nodes: { id: string }[] };
      }>()
    : null;
  if (sde && sdeV) {
    const now = Date.now();
    await RoadmapProgressModel.create({
      userId: id('ananya'),
      roadmapId: sde._id,
      done: sdeV.content.nodes
        .slice(0, 2)
        .map((n, i) => ({ nodeId: n.id, at: new Date(now - (i + 2) * DAY) })),
      nodesPerWeek: 2,
      nextNudgeAt: new Date(now + 7 * DAY),
    });
  }
  // A DEMO community draft (fictional sources on example.org) submitted for review.
  const content = {
    title: 'DEMO: Campus Placement Sprint',
    summary:
      'DEMO roadmap written by a fictional alumnus to show the review workflow. Not real advice; the sources are placeholders.',
    category: 'software',
    branches: ['CSE', 'IT', 'AIML'],
    outcomes: ['DEMO outcome'],
    sources: [
      { title: 'DEMO source one', url: 'https://example.org/demo-source-1' },
      { title: 'DEMO source two', url: 'https://example.org/demo-source-2' },
    ],
    nodes: [
      {
        id: 'resume',
        title: 'DEMO: One-page résumé',
        kind: 'milestone',
        summary: 'DEMO step: write a one-page résumé and ask a mentor to review it.',
        prerequisites: [],
        estimateHours: [3, 6],
        resources: [],
        proof: 'DEMO: a résumé reviewed in a mentorship session.',
        sources: [{ title: 'DEMO source three', url: 'https://example.org/demo-source-3' }],
        needsReview: false,
      },
      {
        id: 'mock',
        title: 'DEMO: Two mock interviews',
        kind: 'milestone',
        summary: 'DEMO step: book two mock interviews with alumni and note what to improve.',
        prerequisites: ['resume'],
        estimateHours: [2, 4],
        resources: [],
        proof: '',
        sources: [],
        needsReview: true,
      },
      {
        id: 'portfolio',
        title: 'DEMO: Portfolio project',
        kind: 'project',
        summary: 'DEMO step: polish one project with a README, tests and a short demo video.',
        prerequisites: ['resume'],
        estimateHours: [15, 30],
        resources: [],
        proof: 'DEMO: a public repository link.',
        sources: [],
        needsReview: true,
      },
    ],
  };
  const r = await RoadmapModel.create({
    slug: 'demo-campus-placement-sprint',
    status: 'in_review',
    title: content.title,
    summary: content.summary,
    category: 'software',
    branches: content.branches,
    nodeCount: content.nodes.length,
    needsReviewCount: 2,
    createdBy: id('rahul'),
    latestVersion: 1,
    openVersion: 1,
  });
  await RoadmapVersionModel.create({
    roadmapId: r._id,
    version: 1,
    status: 'submitted',
    content,
    changeNote: 'DEMO: first draft',
    authorId: id('rahul'),
    editorIds: [id('rahul')],
    submittedAt: new Date(),
  });
}

/** DEMO events, rewards and points (Phase 7). */
async function seedPhase7(ids: Map<string, Types.ObjectId>) {
  const id = (local: string) => {
    const v = ids.get(local);
    if (!v) throw new Error(`seed: missing ${local}`);
    return v;
  };
  const now = Date.now();
  const HOUR = 3_600_000;
  const xp = async (who: string, kind: XpKind, ref: string, daysAgo: number) => {
    const at = new Date(now - daysAgo * DAY);
    const rule = XP_RULES[kind];
    await XpEventModel.create({
      userId: id(who),
      track: rule.track,
      kind,
      points: rule.points,
      refId: `demo-${ref}`,
      dedupeKey: `${kind}:${String(id(who))}:demo-${ref}`,
      day: dayKey(at),
    });
  };
  await xp('ananya', 'roadmap_step', 'step-1', 3);
  await xp('ananya', 'roadmap_step', 'step-2', 2);
  await xp('ananya', 'event_attended', 'event-1', 1);
  await xp('ananya', 'feedback_given', 'fb-1', 0);
  await xp('vikram', 'roadmap_step', 'step-3', 0);
  await xp('vikram', 'session_completed', 'session-1', 4);
  for (let i = 0; i < 6; i++) await xp('rahul', 'session_mentored', `mentored-${i}`, 30 + i);
  await xp('rahul', 'new_mentee', 'mentee-1', 35);
  await xp('rahul', 'new_mentee', 'mentee-2', 33);
  await xp('rahul', 'referral_given', 'ref-1', 5);
  await xp('sneha', 'session_mentored', 'mentored-s', 12);
  await xp('sneha', 'new_mentee', 'mentee-s', 12);
  await UserBadgeModel.create([
    { userId: id('ananya'), badge: 'first_step' },
    { userId: id('rahul'), badge: 'mentor_first' },
  ]);
  await GamificationPrefsModel.create([
    { userId: id('ananya'), showOnLeaderboard: true, showOnWall: false },
    { userId: id('vikram'), showOnLeaderboard: true, showOnWall: false },
    { userId: id('rahul'), showOnLeaderboard: false, showOnWall: true },
  ]);
  await RewardModel.create([
    {
      title: 'DEMO: Certificate of contribution',
      description: 'DEMO reward: a signed certificate from the placement cell.',
      kind: 'certificate',
      track: 'xp',
      cost: 30,
      stock: null,
      createdBy: id('admin'),
    },
    {
      title: 'DEMO: Alumni dinner invite',
      description: 'DEMO reward: a seat at the annual alumni dinner.',
      kind: 'event_invite',
      track: 'impact',
      cost: 50,
      stock: 10,
      createdBy: id('admin'),
    },
  ]);
  const at = (h: number) => new Date(now + h * HOUR);
  const [meetup] = await EventModel.create([
    {
      title: 'DEMO: Alumni meetup, Hyderabad chapter',
      description: 'DEMO event: meet alumni working in Hyderabad and talk about placements and internships.',
      kind: 'meetup',
      mode: 'hybrid',
      startsAt: at(72),
      endsAt: at(75),
      location: 'DEMO venue: Seminar Hall 2',
      onlineUrl: 'https://meet.jit.si/demo-campus-meetup',
      capacity: 40,
      hostId: id('faculty'),
      goingCount: 1,
    },
    {
      title: 'DEMO: AMA on backend careers with Rahul',
      description: 'DEMO AMA: ask anything about backend roles, interviews and first jobs.',
      kind: 'ama',
      mode: 'online',
      startsAt: at(26),
      endsAt: at(27),
      location: '',
      onlineUrl: 'https://meet.jit.si/demo-backend-ama',
      capacity: null,
      hostId: id('rahul'),
      goingCount: 0,
    },
  ]);
  if (meetup)
    await EventRsvpModel.create({
      eventId: meetup._id,
      userId: id('ananya'),
      status: 'going',
      queuedAt: new Date(),
    });
}

async function seedJobs(ids: Map<string, Types.ObjectId>) {
  const id = (local: string) => {
    const v = ids.get(local);
    if (!v) throw new Error(`seed: missing ${local}`);
    return v;
  };
  const now = Date.now();
  const job = (
    by: string,
    f: {
      title: string;
      company: string;
      location: string;
      mode: string;
      type: string;
      level: string;
      skills: string[];
      branches: Branch[];
      slug: string;
      description: string;
      days: number;
      salary?: { min: number; max: number; currency: string; period: 'year' | 'month' };
    },
  ) => {
    const expiresAt = new Date(now + f.days * DAY);
    return JobModel.create({
      origin: 'posted',
      postedBy: id(by),
      title: f.title,
      company: f.company,
      companyKey: companyKey(f.company),
      location: f.location,
      mode: f.mode,
      type: f.type,
      level: f.level,
      skills: f.skills,
      skillKeys: f.skills.map((x) => x.toLowerCase()),
      branches: f.branches,
      salary: f.salary ?? null,
      applyUrl: `https://example.com/demo-careers/${f.slug}`,
      description: f.description,
      freshersOk: f.level === 'fresher' || f.type === 'internship',
      postedAt: new Date(now - 2 * 3600_000),
      expiresAt,
      dedupeKey: `posted-seed-${f.slug}`,
      purgeAt: new Date(expiresAt.getTime() + 60 * DAY),
    });
  };
  const backend = await job('rahul', {
    title: 'DEMO: Backend Developer (freshers)',
    company: 'Nimbus Labs (demo)',
    location: 'Hyderabad',
    mode: 'hybrid',
    type: 'full_time',
    level: 'fresher',
    skills: ['Java', 'Spring Boot', 'SQL'],
    branches: ['CSE', 'IT'],
    slug: 'nimbus-backend',
    description:
      'DEMO listing for trying the app. Build and run REST APIs with Java and Spring Boot. You know data structures, SQL basics and Git.',
    days: 30,
    salary: { min: 600000, max: 800000, currency: 'INR', period: 'year' },
  });
  await job('sneha', {
    title: 'DEMO: Data Analyst Intern',
    company: 'Kestrel Analytics (demo)',
    location: 'Remote (India)',
    mode: 'remote',
    type: 'internship',
    level: 'fresher',
    skills: ['SQL', 'Excel', 'Power BI'],
    branches: [],
    slug: 'kestrel-analyst-intern',
    description:
      'DEMO listing for trying the app. Six-month internship building dashboards from sales data. Any branch.',
    days: 5,
    salary: { min: 20000, max: 25000, currency: 'INR', period: 'month' },
  });
  await job('tpo', {
    title: 'DEMO: Campus drive, Graduate Engineer Trainee',
    company: 'Ironleaf Motors (demo)',
    location: 'Pune',
    mode: 'onsite',
    type: 'full_time',
    level: 'fresher',
    skills: ['AutoCAD', 'SolidWorks'],
    branches: ['MECH', 'EEE'],
    slug: 'ironleaf-get',
    description:
      'DEMO listing for trying the app. On-campus drive for final-year Mechanical and EEE students.',
    days: 14,
  });
  await ReferralPrefsModel.insertMany([
    { userId: id('rahul'), accepting: true, weeklyCap: 5, note: 'DEMO: backend and platform teams' },
    { userId: id('sneha'), accepting: true, weeklyCap: 3, note: '' },
  ]);
  await SavedJobModel.create({
    userId: id('vikram'),
    jobId: backend._id,
    title: backend.title,
    company: backend.company,
    status: 'applied',
    note: 'DEMO: applied through the careers page',
  });
}

async function main() {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();
  await syncIndexes();
  const hash = await hashPassword(password);
  const rows: string[][] = [];

  const platform = await TenantModel.create({
    slug: 'admin',
    kind: 'platform',
    branding: {
      displayName: `${APP_NAME} Platform`,
      shortName: 'Platform',
      primary: '#3fb8e6',
      secondary: '#6d5ae6',
      accent: '#f2b705',
      monogram: 'CL',
    },
  });
  await runInTenant(platform._id, async () => {
    await addUser('superadmin@campuslink.example', 'Platform Operator', ['SUPER_ADMIN'], hash);
    await AuditModel.create({ action: 'seed.created', meta: { kind: 'platform' } });
  });
  rows.push([
    'admin.localhost',
    'superadmin@campuslink.example',
    'SUPER_ADMIN',
    '2FA set-up on first sign-in',
  ]);

  for (const c of COLLEGES) {
    const t = await TenantModel.create({
      slug: c.slug,
      branding: c.branding,
      subscription: { plan: 'trial', seatLimit: 1000, renewalDate: null },
    });
    await runInTenant(t._id, async () => {
      const ids = new Map<string, Types.ObjectId>();
      for (const p of PEOPLE) {
        const email = `${p.local}@${c.domain}`;
        const userId = await addUser(email, p.name, p.roles, hash, {
          ...(p.verified === false ? { verified: false } : {}),
          ...(p.capabilities ? { capabilities: p.capabilities } : {}),
        });
        ids.set(p.local, userId);
        const roll = p.roll
          ? { ...p.roll, no: p.roll.no.replace('XX', c.slug.slice(0, 2).toUpperCase()) }
          : null;
        if (roll) {
          await WhitelistModel.create({
            rollNumber: roll.no,
            name: p.name,
            branch: roll.branch,
            gradYear: roll.gradYear,
            kind: p.roles.includes('ALUMNI') ? 'alumni' : 'student',
            source: 'manual',
            emailEnc: cipher.encrypt(email),
            emailIndex: cipher.blindIndex(email),
            status: 'claimed',
            claimedBy: userId,
            claimedAt: new Date(),
          });
        }
        await ProfileModel.create({
          userId,
          name: p.name,
          roles: p.roles,
          verified: p.verified !== false,
          branch: roll?.branch ?? null,
          gradYear: roll?.gradYear ?? null,
          ...p.profile,
        });
        rows.push([
          `${c.slug}.localhost`,
          email,
          p.roles.join(','),
          [
            p.verified === false ? 'unverified (read-only)' : '',
            p.capabilities?.join(',') ?? '',
            p.roles.includes('COLLEGE_ADMIN') ? '2FA set-up on first sign-in' : '',
          ]
            .filter(Boolean)
            .join('; '),
        ]);
      }
      for (const u of UNCLAIMED) {
        const recEmail = `${u.localEmail}@${c.domain}`;
        await WhitelistModel.create({
          rollNumber: u.no.replace('XX', c.slug.slice(0, 2).toUpperCase()),
          name: u.name,
          branch: u.branch,
          gradYear: u.gradYear,
          kind: u.gradYear < new Date().getFullYear() ? 'alumni' : 'student',
          source: 'manual',
          emailEnc: cipher.encrypt(recEmail),
          emailIndex: cipher.blindIndex(recEmail),
        });
      }
      await seedMentorship(ids);
      await seedFeed(ids);
      await seedJobs(ids);
      await seedRoadmaps(ids);
      await seedPhase7(ids);
      await AuditModel.create({ action: 'seed.created', meta: { kind: 'college' } });
    });
  }

  console.warn(
    `\nSeeded ${COLLEGES.length} demo colleges + platform. Password for every account: ${password}\n`,
  );
  console.warn(['Host', 'Email', 'Role', 'Notes'].join(' | '));
  for (const r of rows) console.warn(r.join(' | '));
  console.warn(
    '\nTry verification: sign in as newbie@dpit.example, open Verify, enter roll number 24DP1A0577; the code arrives in Mailpit (http://localhost:8025).',
  );
  console.warn('Try an import: Admin → Imports → upload docs/samples/sample-students.csv');
  console.warn(
    'Try mentorship: ananya@dpit.example has a session with Rahul starting in a few minutes (Sessions → Join video) and a demo chat; sign in as rahul@dpit.example to see the mentor side.',
  );
  console.warn(
    'Try the feed: sign in as ananya@dpit.example (For you, stories, Q&A); faculty@dpit.example sees a pending question under Admin → Moderation; admin@dpit.example adds RSS sources under Admin → Sources.',
  );
  console.warn(
    'Try jobs: ananya@dpit.example opens Jobs and asks Rahul (Nimbus Labs) for a referral; rahul@dpit.example answers under Referrals; tpo@dpit.example adds job boards under Admin → Job sources.',
  );
  console.warn(
    'Try events and progress: ananya@dpit.example opens Events (RSVP, add to calendar, ask in the AMA) and Progress (XP, badges, rewards); admin@dpit.example opens Admin → Analytics and Admin → Rewards.',
  );
  console.warn(
    'Try roadmaps: ananya@dpit.example opens Roadmaps (Career Galaxy) and marks steps done; faculty@dpit.example reviews Rahul’s DEMO draft under Roadmaps → Review.',
  );
  console.warn(
    '\nOpen http://dpit.localhost:5173 or http://mrce.localhost:5173 (platform console: http://admin.localhost:5173)\n',
  );
  await mongoose.disconnect();
}

main().catch(async (err: unknown) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
