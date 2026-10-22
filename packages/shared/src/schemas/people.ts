import { z } from 'zod';
import { email, objectId, totpCode } from './common.js';
import { AUDIENCES, BRANCHES, IMPORT_FIELDS, PROFILE_FIELDS } from '../constants/people.js';

// ── Member identity ─────────────────────────────
const thisYear = () => new Date().getUTCFullYear();
export const rollNumber = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase().replace(/\s+/g, ''))
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9/-]{3,19}$/, 'Roll numbers are 4–20 letters, digits, / or -'));
export const gradYear = z.coerce
  .number()
  .int()
  .min(1950)
  .max(thisYear() + 6);
/** Indian mobile numbers normalised to E.164 (+91XXXXXXXXXX); other countries kept if already E.164. */
export const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .transform((v) =>
    /^[6-9]\d{9}$/.test(v)
      ? `+91${v}`
      : /^0[6-9]\d{9}$/.test(v)
        ? `+91${v.slice(1)}`
        : /^91[6-9]\d{9}$/.test(v)
          ? `+${v}`
          : v,
  )
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use a valid mobile number'));

// ── Imports ─────────────────────────────
export const importMapping = z.strictObject({
  columns: z.partialRecord(z.enum(IMPORT_FIELDS), z.string().min(1).max(100)),
  /** Used when no `kind` column: derive from graduation year, or force one value. */
  defaultKind: z.enum(['derive', 'student', 'alumni']).default('derive'),
});
export type ImportMapping = z.infer<typeof importMapping>;

export const httpsUrl = z.url({ protocol: /^https$/, error: 'Use an https:// link' }).max(2000);
export const importSourceBody = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('gsheet'), url: httpsUrl }),
  z.strictObject({
    kind: z.literal('rest'),
    url: httpsUrl,
    /** Dot path to the array of records in the JSON response, e.g. `data.students`. */
    recordsPath: z
      .string()
      .regex(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/)
      .max(100)
      .optional(),
    bearerToken: z.string().min(8).max(2000).optional(),
  }),
]);
export type ImportSourceBody = z.infer<typeof importSourceBody>;

export interface ImportPreview {
  previewId: string;
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
  suggestedMapping: ImportMapping['columns'];
}

export const startImportBody = z.strictObject({
  previewId: z.string().regex(/^[a-f0-9]{24}$/),
  mapping: importMapping,
  dryRun: z.boolean().default(false),
});

export const whitelistRecordBody = z.strictObject({
  rollNumber,
  name: z.string().trim().min(2).max(120),
  branch: z.enum(BRANCHES).optional(),
  gradYear: gradYear.optional(),
  email: email.optional(),
  phone: phone.optional(),
  kind: z.enum(['student', 'alumni']),
  sendInvite: z.boolean().default(false),
});

export const bulkInviteBody = z.strictObject({
  emails: z.array(email).min(1).max(200),
});

// ── Verification ─────────────────────────────
export const startVerificationBody = z.strictObject({ rollNumber, gradYear: gradYear.optional() });
export const confirmVerificationBody = z.strictObject({ challengeId: objectId, code: totpCode });
export const idVerificationFields = z.strictObject({
  rollNumber,
  gradYear: gradYear.optional(),
  note: z.string().trim().max(500).optional(),
});
export const verificationDecisionBody = z.strictObject({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(3).max(300).optional(),
});
export const companyEmailStartBody = z.strictObject({ email, company: z.string().trim().min(2).max(80) });
export const companyEmailConfirmBody = z.strictObject({ challengeId: objectId, code: totpCode });

/** Free webmail domains cannot prove employment. */
export const FREE_MAIL_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'rediffmail.com',
  'aol.com',
  'zoho.com',
  'yandex.com',
  'gmx.com',
  'mail.com',
];

// ── Profiles ─────────────────────────────
export const tag = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[^<>{}$]+$/);
const LINK_HOSTS =
  /^(www\.)?(linkedin\.com|github\.com|gitlab\.com|behance\.net|dribbble\.com|medium\.com|dev\.to|kaggle\.com|leetcode\.com|codeforces\.com|[a-z0-9-]+\.(dev|io|me|in|com|org|net|app|site))$/i;
export const profileLink = z.strictObject({
  label: z.enum(['linkedin', 'github', 'portfolio', 'other']),
  url: httpsUrl.refine(
    (u) => LINK_HOSTS.test(/^https:\/\/([^/:?#]+)/i.exec(u)?.[1] ?? ''),
    'Use a public profile or portfolio link',
  ),
});

export const profileBody = z.strictObject({
  headline: z.string().trim().max(120).optional(),
  company: z.string().trim().max(80).optional(),
  jobTitle: z.string().trim().max(80).optional(),
  location: z.string().trim().max(80).optional(),
  bio: z.string().trim().max(1000).optional(),
  skills: z.array(tag).max(20).optional(),
  topics: z.array(tag).max(15).optional(),
  languages: z.array(tag).max(8).optional(),
  links: z.array(profileLink).max(5).optional(),
  phone: phone.optional().or(z.literal('')),
  visibility: z.partialRecord(z.enum(PROFILE_FIELDS), z.enum(AUDIENCES)).optional(),
});
export type ProfileBody = z.infer<typeof profileBody>;

export const directoryQuery = z.strictObject({
  q: z.string().trim().max(80).optional(),
  role: z.enum(['ALUMNI', 'STUDENT', 'FACULTY', 'TPO']).optional(),
  branch: z.enum(BRANCHES).optional(),
  batchFrom: gradYear.optional(),
  batchTo: gradYear.optional(),
  cursor: z
    .string()
    .regex(/^[a-f0-9]{24}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(30).default(20),
});
export const searchQuery = z.strictObject({ q: z.string().trim().min(2).max(80) });

/** What a viewer may see of someone else's profile (fields omitted when not visible). */
export interface PublicProfile {
  userId: string;
  name: string;
  roles: string[];
  verified: boolean;
  avatarFileId: string | null;
  companyVerified: { company: string; domain: string } | null;
  fields: Partial<{
    headline: string;
    company: string;
    jobTitle: string;
    location: string;
    bio: string;
    skills: string[];
    topics: string[];
    languages: string[];
    links: { label: string; url: string }[];
    email: string;
    phone: string;
    branch: string;
    gradYear: number;
  }>;
}
