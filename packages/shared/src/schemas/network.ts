import { z } from 'zod';
import { objectId, email, personName } from './common.js';
import { BRANCHES, type Branch } from '../constants/people.js';
import { SESSION_TYPES, type SessionType } from '../constants/mentorship.js';
import {
  CREDENTIAL_TYPES,
  EMPLOYER_LIMITS,
  EMPLOYER_SLUG_PREFIX,
  INTRO_DECLINE_REASONS,
  INTRO_GOALS,
  INTRO_SHARE,
  NAME_STYLES,
  NETWORK_INTROS_RECEIVED_MAX,
  NETWORK_INTRO_NOTE_MAX,
  POSTING_DECLINE_REASONS,
  POSTING_TYPES,
  READINESS_MILESTONES,
  SEEKING,
  isFreeMailDomain,
  isValidGstin,
  type CandidacyStage,
  type CredentialStatus,
  type CredentialType,
  type EmployerStatus,
  type IntroDeclineReason,
  type IntroGoal,
  type IntroStatus,
  type PostingDecision,
  type PostingDeclineReason,
  type PostingStatus,
  type PostingType,
} from '../constants/network.js';

/**
 * The network (prompt 2, G12, ADR 0014). Every cross-college answer is built from the opt-in
 * projections only; the view types below are exactly what crosses a college boundary.
 */

const ref = z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'Invalid reference');
export const networkRefParams = z.strictObject({ ref });
const year = z.number().int().min(1950).max(2100);
const linkedin = z
  .string()
  .trim()
  .max(200)
  .regex(
    /^https:\/\/(www\.|[a-z]{2}\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]{2,100}\/?$/,
    'Paste your LinkedIn profile link',
  );

// ── Member settings ─────────────────────────────

export const networkSettingsBody = z.strictObject({
  nameStyle: z.enum(NAME_STYLES),
  showCompany: z.boolean(),
  showCity: z.boolean(),
  showSkills: z.boolean(),
  linkedinUrl: linkedin.nullable(),
  helpWith: z.array(z.enum(SESSION_TYPES)).max(SESSION_TYPES.length),
  acceptingIntros: z.boolean(),
  introsPerWeek: z.number().int().min(1).max(NETWORK_INTROS_RECEIVED_MAX),
  seeking: z.enum(SEEKING).nullable(),
});
export type NetworkSettingsBody = z.output<typeof networkSettingsBody>;

export interface NetworkSettingsView {
  /** The college's switches (ADR 0014 §2). */
  college: { alumniDiscovery: boolean; employerAccess: boolean; credentials: boolean };
  consents: { network_discovery: boolean; employer_visibility: boolean };
  settings: NetworkSettingsBody;
  /** Under 18: nothing here applies (N8). */
  minor: boolean;
  /** Two reports from different alumni paused network access until the college reviews it. */
  paused: boolean;
  /** Whether a projection exists now (the member is visible to the network). */
  visible: { discovery: boolean; employers: boolean };
  /** Employers that opened this member's résumé or readiness (N16). */
  viewedBy: { employer: string; what: 'resume' | 'readiness'; at: string }[];
}

// ── Alumni discovery ─────────────────────────────

export const networkSearchQuery = z.strictObject({
  company: z.string().trim().min(2).max(80).optional(),
  q: z.string().trim().min(2).max(60).optional(),
  branch: z.enum(BRANCHES).optional(),
  cursor: z
    .string()
    .regex(/^\d{1,4}$/)
    .optional(),
});
/** A `NetworkProfile` as another college sees it: `NETWORK_PUBLIC_FIELDS` and nothing else. */
export interface NetworkCard {
  ref: string;
  name: string;
  college: { name: string; city: string | null };
  branch: Branch | null;
  gradYear: number | null;
  company: string | null;
  roleTitle: string | null;
  city: string | null;
  skills: string[];
  helpWith: SessionType[];
  linkedinUrl: string | null;
}
export interface NetworkSearchView {
  items: NetworkCard[];
  nextCursor: string | null;
}

// ── Intros ─────────────────────────────

export const introBody = z.strictObject({
  ref,
  helpWith: z.enum(SESSION_TYPES),
  goal: z.enum(INTRO_GOALS),
  note: z.string().trim().max(NETWORK_INTRO_NOTE_MAX).default(''),
});
export const introAcceptBody = z.strictObject({
  share: z.array(z.enum(INTRO_SHARE)).min(1).max(INTRO_SHARE.length),
});
export const introDeclineBody = z.strictObject({ reason: z.enum(INTRO_DECLINE_REASONS) });
export const introReportBody = z.strictObject({ reason: z.string().trim().min(3).max(300) });
export interface IntroReceivedView {
  id: string;
  from: { name: string; college: string; branch: Branch | null; gradYear: number | null };
  helpWith: SessionType;
  goal: IntroGoal;
  note: string;
  status: IntroStatus;
  declineReason: IntroDeclineReason | null;
  createdAt: string;
  expiresAt: string;
}
export interface IntroSentView {
  id: string;
  to: { name: string; college: string; company: string | null };
  helpWith: SessionType;
  goal: IntroGoal;
  status: IntroStatus;
  declineReason: IntroDeclineReason | null;
  /** What the alumnus chose to share on accepting (only the requester sees it). */
  shared: { linkedin?: string; email?: string } | null;
  createdAt: string;
  expiresAt: string;
}
export interface IntrosView {
  received: IntroReceivedView[];
  sent: IntroSentView[];
  /** Intros the member may still send this week. */
  left: number;
}

// ── The college's side ─────────────────────────────

export const networkSwitchBody = z.strictObject({
  alumniDiscovery: z.boolean().optional(),
  employerAccess: z.boolean().optional(),
  credentials: z.boolean().optional(),
  /** Required to turn any switch on: the admin accepts the network terms (NETWORK_TERMS_VERSION). */
  acceptTerms: z.boolean().default(false),
});
export const postingDecisionBody = z.discriminatedUnion('decision', [
  z.strictObject({
    decision: z.literal('approved'),
    /** The drive the approval creates (B7): when registration closes and the drive takes place. */
    registrationCloseAt: z.iso.datetime(),
    driveDate: z.iso.datetime(),
  }),
  z.strictObject({ decision: z.literal('declined'), reason: z.enum(POSTING_DECLINE_REASONS) }),
]);
export const blockEmployerBody = z.strictObject({ employerId: objectId });
export interface CollegePostingView {
  id: string;
  employer: { id: string; name: string };
  title: string;
  role: string;
  type: PostingType;
  location: string;
  ctcRange: string;
  description: string;
  branches: Branch[];
  gradYears: number[];
  closesAt: string;
  decision: PostingDecision;
  declineReason: PostingDeclineReason | null;
  driveId: string | null;
  reports: number;
  offeredAt: string;
}
export interface NetworkAdminView {
  switches: { alumniDiscovery: boolean; employerAccess: boolean; credentials: boolean };
  termsVersion: number | null;
  changedAt: string | null;
  postings: CollegePostingView[];
  blocked: { id: string; name: string }[];
  /** Cross-college reads of this college's data in the last 30 days, by path (audit summary). */
  activity: { reason: string; count: number }[];
  members: { discoverable: number | '<5'; employerVisible: number | '<5' };
}

// ── Employers ─────────────────────────────

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .max(100)
  .regex(
    /^(?=.{4,100}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/,
    'Enter the company’s domain, like acme.com',
  )
  .refine((d) => !isFreeMailDomain(d), 'Use your company’s own domain, not a mail provider');
export const gstin = z.string().trim().toUpperCase().refine(isValidGstin, 'Enter a valid 15-character GSTIN');
export const employerSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^emp-[a-z0-9][a-z0-9-]{0,26}[a-z0-9]$/,
    `Starts with ${EMPLOYER_SLUG_PREFIX}, letters, digits and hyphens`,
  );
export const employerApplyBody = z
  .strictObject({
    companyName: z.string().trim().min(2).max(120),
    legalName: z.string().trim().min(2).max(160),
    domain,
    gstin,
    slug: employerSlug,
    name: personName,
    email,
  })
  .refine((b) => b.email.split('@')[1] === b.domain, {
    message: 'Use your work email at the company’s domain',
    path: ['email'],
  });
export type EmployerApplyBody = z.output<typeof employerApplyBody>;
export const employerCodeBody = z.strictObject({ code: z.string().regex(/^\d{6}$/) });
export const recruiterBody = z.strictObject({ name: personName, email });
export interface EmployerView {
  id: string;
  name: string;
  legalName: string;
  domain: string;
  gstin: string;
  status: EmployerStatus;
  emailVerified: boolean;
  dnsToken: string;
  domainVerifiedAt: string | null;
  recruiters: { id: string; name: string; email: string; admin: boolean }[];
  limits: typeof EMPLOYER_LIMITS;
  pricing: { perPosting: number; perDrive: number; perHire: number };
}

export const postingBody = z.strictObject({
  title: z.string().trim().min(3).max(120),
  role: z.string().trim().min(2).max(120),
  type: z.enum(POSTING_TYPES),
  location: z.string().trim().min(2).max(120),
  /** As the employer chooses to state it (text, e.g. "6 to 8 LPA"). */
  ctcRange: z.string().trim().max(60).default(''),
  description: z.string().trim().min(20).max(4000),
  branches: z.array(z.enum(BRANCHES)).max(BRANCHES.length).default([]),
  gradYears: z.array(year).max(4).default([]),
  closesAt: z.iso.datetime(),
});
export const postingPublishBody = z.union([
  z.strictObject({ colleges: z.array(objectId).min(1).max(EMPLOYER_LIMITS.collegesPerPosting) }),
  z.strictObject({ clusterId: objectId }),
]);
export interface PostingView {
  id: string;
  title: string;
  role: string;
  type: PostingType;
  location: string;
  ctcRange: string;
  description: string;
  branches: Branch[];
  gradYears: number[];
  closesAt: string;
  status: PostingStatus;
  colleges: { id: string; name: string; decision: PostingDecision; candidates: number }[];
  createdAt: string;
}
export interface NetworkCollegeView {
  id: string;
  name: string;
  city: string | null;
}
export interface ClusterView {
  id: string;
  name: string;
  colleges: NetworkCollegeView[];
}

export const poolQuery = z.strictObject({
  colleges: z
    .string()
    .regex(/^[a-f0-9]{24}(,[a-f0-9]{24}){0,49}$/i)
    .optional(),
  branch: z.enum(BRANCHES).optional(),
  gradYear: z.coerce.number().int().min(1950).max(2100).optional(),
  seeking: z.enum(SEEKING).optional(),
  skills: z
    .string()
    .trim()
    .max(130)
    .optional()
    .transform((s) =>
      s
        ? s
            .split(',')
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 3)
        : [],
    ),
});
export interface PoolView {
  total: number | '<5';
  byCollege: { id: string; name: string; count: number | '<5' }[];
}

/** A shared candidacy as the employer sees it (`CANDIDACY_EMPLOYER_FIELDS`). */
export interface CandidateView {
  ref: string;
  name: string;
  college: string;
  branch: Branch | null;
  gradYear: number | null;
  stage: CandidacyStage;
  hasResume: boolean;
  sharedAt: string;
}
export const candidateStageBody = z.strictObject({ stage: z.enum(['shortlisted', 'not_selected']) });
export interface CandidateReadinessView {
  score: number;
  components: { id: string; points: number; max: number }[];
}
export interface ResumeLinkView {
  url: string;
  expiresAt: string;
}

export const employerDecisionBody = z.strictObject({
  decision: z.enum(['approve', 'reject', 'suspend', 'reinstate']),
  note: z.string().trim().max(500).default(''),
});
export interface EmployerReviewView extends EmployerView {
  applicant: { name: string; email: string } | null;
  blocks: number;
  createdAt: string;
}
export const clusterBody = z.strictObject({
  name: z.string().trim().min(2).max(80),
  colleges: z.array(objectId).min(1).max(EMPLOYER_LIMITS.collegesPerPosting),
});
export interface BillableView {
  kind: 'posting' | 'drive' | 'hire';
  amount: number;
  college: string | null;
  at: string;
}
export interface RevenueStatementView {
  month: string;
  colleges: {
    id: string;
    name: string;
    postings: number;
    drives: number;
    hires: number;
    amount: number;
    share: number;
  }[];
}

// ── Candidacies (the student's side) ─────────────────────────────

export const candidacyBody = z.strictObject({ driveId: objectId });
export interface MyCandidacyView {
  ref: string;
  employer: string;
  driveId: string;
  title: string;
  stage: CandidacyStage;
  sharedAt: string;
}

// ── Verified credentials ─────────────────────────────

export const credentialIssueBody = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('PlacementOfferCredential'),
    sourceId: objectId,
    nameStyle: z.enum(NAME_STYLES),
  }),
  z.strictObject({
    type: z.literal('ReadinessMilestoneCredential'),
    milestone: z.union(READINESS_MILESTONES.map((m) => z.literal(m)) as [z.ZodLiteral<60>, z.ZodLiteral<80>]),
    nameStyle: z.enum(NAME_STYLES),
  }),
  z.strictObject({
    type: z.literal('MentorCertificateCredential'),
    sourceId: objectId,
    nameStyle: z.enum(NAME_STYLES),
  }),
  z.strictObject({
    type: z.literal('MentorshipRecognitionCredential'),
    sourceId: objectId,
    nameStyle: z.enum(NAME_STYLES),
  }),
]);
export type CredentialIssueBody = z.output<typeof credentialIssueBody>;
export const credentialIdParams = z.strictObject({ id: z.string().regex(/^[A-Za-z0-9_-]{22}$/) });
export interface CredentialView {
  id: string;
  type: CredentialType;
  name: string;
  claims: Record<string, string | number>;
  status: CredentialStatus;
  issuedAt: string;
  url: string;
}
export interface CredentialSource {
  type: CredentialType;
  sourceId: string | null;
  milestone: number | null;
  label: string;
  issued: boolean;
}
export interface MyCredentialsView {
  enabled: boolean;
  minor: boolean;
  credentials: CredentialView[];
  sources: CredentialSource[];
}
export interface IssuerKeyView {
  kid: string;
  status: 'active' | 'retired' | 'compromised';
  createdAt: string;
}
export interface CredentialsAdminView {
  enabled: boolean;
  did: string;
  keys: IssuerKeyView[];
  issued: number;
  revoked: number;
}
export const credentialKidParams = z.strictObject({ kid: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) });
export const credentialTypes = z.enum(CREDENTIAL_TYPES);
