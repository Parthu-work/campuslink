import { z } from 'zod';
import { objectId } from './common.js';
import { httpsUrl } from './people.js';
import type { PersonRef } from './mentorship.js';
import type { AuthorRef } from './feed.js';
import {
  JOB_DESCRIPTION_MAX,
  JOB_LEVELS,
  JOB_MODES,
  JOB_TYPES,
  type JobLevel,
  type JobMode,
  type JobSourceKind,
  type JobType,
  REFERRAL_DECLINE_TEMPLATES,
  REFERRAL_STATUSES,
  type ReferralStatus,
  TRACK_STATUSES,
  type TrackStatus,
} from '../constants/jobs.js';
import { BRANCHES, type Branch } from '../constants/people.js';

// ── Vocabulary ─────────────────────────────
/**
 * Skills recognised in imported job text (posted jobs may use any skill). Matching is
 * case-insensitive on word boundaries; the display form is the value here.
 */
export const SKILL_VOCABULARY = [
  'Java',
  'Python',
  'JavaScript',
  'TypeScript',
  'C',
  'C++',
  'C#',
  'Go',
  'Rust',
  'Kotlin',
  'Swift',
  'Dart',
  'PHP',
  'Ruby',
  'Scala',
  'R',
  'SQL',
  'NoSQL',
  'HTML',
  'CSS',
  'React',
  'Angular',
  'Vue',
  'Next.js',
  'Node.js',
  'Express',
  'Spring',
  'Spring Boot',
  'Django',
  'Flask',
  'FastAPI',
  '.NET',
  'Android',
  'iOS',
  'Flutter',
  'React Native',
  'MongoDB',
  'PostgreSQL',
  'MySQL',
  'Redis',
  'Kafka',
  'Elasticsearch',
  'GraphQL',
  'REST',
  'Microservices',
  'AWS',
  'Azure',
  'GCP',
  'Docker',
  'Kubernetes',
  'Terraform',
  'Linux',
  'Git',
  'CI/CD',
  'Jenkins',
  'Ansible',
  'Spark',
  'Hadoop',
  'Airflow',
  'dbt',
  'Snowflake',
  'Excel',
  'Power BI',
  'Tableau',
  'Statistics',
  'Machine Learning',
  'Deep Learning',
  'NLP',
  'Computer Vision',
  'TensorFlow',
  'PyTorch',
  'scikit-learn',
  'Pandas',
  'LLM',
  'Selenium',
  'Cypress',
  'Playwright',
  'Manual Testing',
  'Automation Testing',
  'Figma',
  'UI/UX',
  'Product Management',
  'Agile',
  'Cybersecurity',
  'Networking',
  'Embedded C',
  'RTOS',
  'Verilog',
  'VHDL',
  'VLSI',
  'PCB Design',
  'IoT',
  'MATLAB',
  'Simulink',
  'PLC',
  'SCADA',
  'AutoCAD',
  'SolidWorks',
  'CATIA',
  'ANSYS',
  'Creo',
  'CNC',
  'Revit',
  'STAAD Pro',
  'ETABS',
  'Primavera',
  'Aspen Plus',
  'HYSYS',
  'Six Sigma',
  'Lean Manufacturing',
  'Quality Control',
  'SAP',
] as const;

// ── Bodies ─────────────────────────────
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const skill = z.string().trim().min(1).max(40);
export const salarySchema = z
  .strictObject({
    min: z.number().int().min(0).max(100_000_000),
    max: z.number().int().min(0).max(100_000_000),
    currency: z.enum(['INR', 'USD', 'EUR', 'GBP']).default('INR'),
    period: z.enum(['year', 'month']).default('year'),
  })
  .refine((s) => s.max >= s.min, { message: 'Maximum must be at least the minimum', path: ['max'] });

export const jobBody = z.strictObject({
  title: text(3, 120),
  company: text(2, 80),
  location: text(2, 80),
  mode: z.enum(JOB_MODES),
  type: z.enum(JOB_TYPES),
  level: z.enum(JOB_LEVELS),
  skills: z.array(skill).max(12).default([]),
  branches: z.array(z.enum(BRANCHES)).max(6).default([]),
  salary: salarySchema.optional(),
  applyUrl: httpsUrl,
  description: text(30, JOB_DESCRIPTION_MAX),
  freshersOk: z.boolean().default(false),
  expiresInDays: z.number().int().min(7).max(60).default(30),
});
export type JobBody = z.infer<typeof jobBody>;

const csv = (max: number) =>
  z
    .string()
    .max(400)
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, max),
    );
export const jobsQuery = z.strictObject({
  q: z.string().trim().max(80).optional(),
  skills: csv(8).optional(),
  branch: z.enum(BRANCHES).optional(),
  level: z.enum(JOB_LEVELS).optional(),
  mode: z.enum(JOB_MODES).optional(),
  type: z.enum(JOB_TYPES).optional(),
  location: z.string().trim().max(60).optional(),
  fresher: z.enum(['true']).optional(),
  alumni: z.enum(['true']).optional(),
  mine: z.enum(['true']).optional(),
  cursor: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(30).default(20),
});
export type JobsQuery = z.output<typeof jobsQuery>;

export const trackBody = z.strictObject({
  status: z.enum(TRACK_STATUSES),
  note: z.string().trim().max(500).optional(),
});

export const alertFilters = z.strictObject({
  q: z.string().trim().max(80).optional(),
  skills: z.array(skill).max(8).optional(),
  branch: z.enum(BRANCHES).optional(),
  level: z.enum(JOB_LEVELS).optional(),
  mode: z.enum(JOB_MODES).optional(),
  type: z.enum(JOB_TYPES).optional(),
  location: z.string().trim().max(60).optional(),
  fresher: z.boolean().optional(),
});
export type AlertFilters = z.infer<typeof alertFilters>;
export const alertBody = z.strictObject({ name: text(2, 60), filters: alertFilters });

export const referralPrefsBody = z.strictObject({
  accepting: z.boolean(),
  weeklyCap: z.number().int().min(1).max(20),
  note: z.string().trim().max(300).optional(),
});
export const referralRequestBody = z.strictObject({
  jobId: objectId,
  referrerId: objectId,
  why: text(30, 800),
  resumeFileId: objectId.optional(),
});
export const referralRespondBody = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('refer'), note: z.string().trim().max(300).optional() }),
  z.strictObject({
    action: z.literal('decline'),
    template: z.enum(REFERRAL_DECLINE_TEMPLATES),
    note: z.string().trim().max(300).optional(),
  }),
]);
export const referralsQuery = z.strictObject({
  box: z.enum(['received', 'sent']).default('received'),
  status: z.enum(REFERRAL_STATUSES).optional(),
  cursor: objectId.optional(),
});

const sourceCommon = {
  name: text(2, 80),
  company: text(2, 80).optional(),
  branches: z.array(z.enum(BRANCHES)).max(6).default([]),
  /** Boards often list worldwide; keep only openings in India. */
  indiaOnly: z.boolean().default(true),
  intervalMin: z
    .number()
    .int()
    .refine((n) => [180, 360, 720, 1440].includes(n), 'Unsupported interval')
    .default(720),
};
const boardToken = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{2,80}$/, 'Use the board name from the careers URL');
export const jobSourceBody = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('greenhouse'), board: boardToken, ...sourceCommon }),
  z.strictObject({ kind: z.literal('lever'), board: boardToken, ...sourceCommon }),
  z.strictObject({ kind: z.literal('ashby'), board: boardToken, ...sourceCommon }),
  z.strictObject({ kind: z.literal('smartrecruiters'), board: boardToken, ...sourceCommon }),
  z.strictObject({
    kind: z.literal('adzuna'),
    query: text(2, 80),
    where: z.string().trim().max(60).optional(),
    ...sourceCommon,
  }),
  z.strictObject({ kind: z.literal('rss'), url: httpsUrl, ...sourceCommon }),
]);
export type JobSourceBody = z.infer<typeof jobSourceBody>;
export const jobSourceUpdateBody = z.strictObject({
  name: text(2, 80).optional(),
  status: z.enum(['active', 'paused']).optional(),
  intervalMin: sourceCommon.intervalMin.optional(),
  branches: z.array(z.enum(BRANCHES)).max(6).optional(),
});

// ── Views ─────────────────────────────
export interface Salary {
  min: number;
  max: number;
  currency: string;
  period: 'year' | 'month';
}
export interface JobView {
  id: string;
  title: string;
  company: string;
  location: string;
  mode: JobMode | null;
  type: JobType;
  level: JobLevel | null;
  skills: string[];
  branches: Branch[];
  salary: Salary | null;
  applyUrl: string;
  description: string;
  freshersOk: boolean;
  origin: 'posted' | JobSourceKind;
  source: { name: string; attribution: string | null } | null;
  postedBy: AuthorRef | null;
  postedAt: string;
  expiresAt: string;
  status: 'open' | 'closed' | 'expired';
  isMine: boolean;
  /** Verified alumni whose company (visible to you) matches. */
  alumniCount: number;
  /** Of those, how many accept referral requests right now. */
  referrers: number;
  track: { status: TrackStatus; note: string; updatedAt: string } | null;
}
export interface RadarView {
  forYou: JobView[];
  alumniCanRefer: JobView[];
  fresherFriendly: JobView[];
  closingSoon: JobView[];
  newThisWeek: number;
}
export interface TrackedJobView {
  jobId: string;
  title: string;
  company: string;
  status: TrackStatus;
  note: string;
  updatedAt: string;
  /** null when the listing has gone (expired, closed or removed). */
  job: JobView | null;
}
export interface JobAlertView {
  id: string;
  name: string;
  filters: AlertFilters;
  lastRunAt: string | null;
  createdAt: string;
}
export interface ReferrerView extends PersonRef {
  headline: string;
  jobTitle: string;
  gradYear: number | null;
  branch: Branch | null;
  companyVerified: boolean;
  note: string;
  /** False when their weekly cap is used up. */
  available: boolean;
}
export interface ReferralView {
  id: string;
  status: ReferralStatus;
  job: { id: string; title: string; company: string };
  requester: PersonRef;
  referrer: PersonRef;
  why: string;
  resumeFileId: string | null;
  responseNote: string | null;
  declineTemplate: (typeof REFERRAL_DECLINE_TEMPLATES)[number] | null;
  createdAt: string;
  respondedAt: string | null;
  expiresAt: string;
}
export interface ReferralPrefsView {
  accepting: boolean;
  weeklyCap: number;
  note: string;
  company: string;
  usedThisWeek: number;
}
export interface JobSourceView {
  id: string;
  kind: JobSourceKind;
  name: string;
  target: string;
  company: string;
  branches: Branch[];
  intervalMin: number;
  status: 'active' | 'paused';
  starterKey: string | null;
  health: {
    state: 'ok' | 'failing' | 'blocked' | 'new';
    lastFetchedAt: string | null;
    lastError: string | null;
    consecutiveFailures: number;
    openJobs: number;
    nextFetchAt: string | null;
  };
}
