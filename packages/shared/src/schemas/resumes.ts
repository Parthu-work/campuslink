import { z } from 'zod';

/**
 * Résumés (prompt 2, G2): a JSON Resume-compatible subset (https://jsonresume.org/schema), rendered
 * as a single-column PDF with real text, the shape applicant tracking systems read reliably.
 * Written in English: ATS read English, and the PDF font covers Latin script only.
 */
export const RESUME_TEMPLATES = ['classic', 'compact'] as const;
export type ResumeTemplate = (typeof RESUME_TEMPLATES)[number];
export const RESUME_SECTIONS = [
  'basics',
  'education',
  'work',
  'projects',
  'skills',
  'certificates',
  'awards',
] as const;
export type ResumeSection = (typeof RESUME_SECTIONS)[number];
/** Résumés a member may keep (for example "Core IT" and "Analyst"). */
export const RESUMES_PER_MEMBER = 5;

/** Devanagari or Telugu script: the résumé itself stays English. */
export const NON_LATIN_SCRIPT = /[\p{Script=Devanagari}\p{Script=Telugu}]/u;
const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .refine(
      (s) => !NON_LATIN_SCRIPT.test(s),
      'Write your résumé in English: applicant tracking systems read English',
    );
/** `2024`, `2024-06` or empty (an end date left empty means "present"). */
const date = z
  .string()
  .trim()
  .regex(/^(\d{4}(-(0[1-9]|1[0-2]))?)?$/, 'Use YYYY or YYYY-MM')
  .default('');
const bullets = z.array(line(220)).max(6).default([]);

export const resumeContent = z.strictObject({
  basics: z.strictObject({
    name: line(80),
    label: line(80).default(''),
    email: z.union([z.literal(''), z.email().max(120)]).default(''),
    phone: line(30).default(''),
    location: line(80).default(''),
    summary: line(600).default(''),
    profiles: z
      .array(
        z.strictObject({
          network: line(30),
          url: z
            .url()
            .max(200)
            .refine((u) => u.startsWith('https://'), 'Use an https link'),
        }),
      )
      .max(4)
      .default([]),
  }),
  education: z
    .array(
      z.strictObject({
        institution: line(120),
        area: line(80).default(''),
        studyType: line(60).default(''),
        startDate: date,
        endDate: date,
        score: line(30).default(''),
      }),
    )
    .max(5)
    .default([]),
  work: z
    .array(
      z.strictObject({
        name: line(100),
        position: line(80),
        startDate: date,
        endDate: date,
        highlights: bullets,
      }),
    )
    .max(8)
    .default([]),
  projects: z
    .array(
      z.strictObject({
        name: line(100),
        description: line(300).default(''),
        url: z.union([z.literal(''), z.url().max(200)]).default(''),
        highlights: bullets,
      }),
    )
    .max(8)
    .default([]),
  skills: z
    .array(z.strictObject({ name: line(60), keywords: z.array(line(40)).max(15).default([]) }))
    .max(10)
    .default([]),
  certificates: z
    .array(z.strictObject({ name: line(120), issuer: line(80).default(''), date: date }))
    .max(10)
    .default([]),
  awards: z
    .array(z.strictObject({ title: line(120), awarder: line(80).default(''), date: date }))
    .max(10)
    .default([]),
});
export type ResumeContent = z.infer<typeof resumeContent>;

export const resumeCreateBody = z.strictObject({
  title: line(60).refine((s) => s.length > 0, 'Give it a name'),
  template: z.enum(RESUME_TEMPLATES).default('classic'),
  /** Left out: prefilled from the profile, academics and roadmap certificates. */
  content: resumeContent.optional(),
});
export const resumeUpdateBody = z.strictObject({
  /** The version the edit started from: a stale save is refused rather than overwriting. */
  version: z.number().int().min(1),
  title: line(60).optional(),
  template: z.enum(RESUME_TEMPLATES).optional(),
  content: resumeContent.optional(),
});
export const resumeIdParams = z.strictObject({ id: z.string().regex(/^[a-f0-9]{24}$/) });

export const atsCheckBody = z
  .strictObject({
    /** A job description the member pastes, or a drive whose role to check against. */
    jobDescription: z.string().trim().max(6000).optional(),
    driveId: z
      .string()
      .regex(/^[a-f0-9]{24}$/)
      .optional(),
  })
  .refine((b) => !(b.jobDescription && b.driveId), 'Paste a job description or pick a drive, not both');

export const rewriteBody = z.strictObject({
  section: z.enum(['work', 'projects']),
  /** Which entry of the section, and which bullet in it. */
  entry: z.number().int().min(0).max(7),
  bullet: z.number().int().min(0).max(5),
});

export const RESUME_COMMENT_SECTIONS = [...RESUME_SECTIONS, 'general'] as const;
export const resumeCommentBody = z.strictObject({
  section: z.enum(RESUME_COMMENT_SECTIONS),
  body: z.string().trim().min(2).max(1000),
});

// ── Views ─────────────────────────────

export interface AtsCheck {
  id: 'name' | 'contact' | 'education' | 'skills' | 'experience' | 'dates' | 'length' | 'images' | 'bullets';
  ok: boolean;
  /** Points this check is worth, and what it earned. */
  points: number;
  earned: number;
}
export interface AtsReport {
  /** Out of 100: parseability (60) plus keyword coverage (40), or parseability alone scaled to 100. */
  score: number;
  checks: AtsCheck[];
  /** Against a job description or a drive's role, when one was given. */
  keywords: { source: 'pasted' | 'drive'; matched: string[]; missing: string[] } | null;
  /** Short gaps worth closing (AI-summarised when available, else the missing keywords). */
  gaps: string[];
  pages: number;
  version: number;
  checkedAt: string;
}

export interface ResumeSummaryView {
  id: string;
  title: string;
  template: ResumeTemplate;
  version: number;
  atsScore: number | null;
  updatedAt: string;
}
export interface ResumeView extends ResumeSummaryView {
  content: ResumeContent;
  atsReport: AtsReport | null;
  /** The viewer's relation to it: the owner edits; a reviewer reads and comments. */
  mine: boolean;
  owner: { id: string; name: string };
}
export interface ResumeCommentView {
  id: string;
  section: (typeof RESUME_COMMENT_SECTIONS)[number];
  body: string;
  author: { id: string; name: string } | null;
  resumeVersion: number;
  mine: boolean;
  createdAt: string;
}
export interface RewriteView {
  original: string;
  /** Up to three: each keeps the facts and numbers the member wrote. */
  alternatives: string[];
  /** `ai` when a model wrote them, `rules` for the offline suggestions. */
  source: 'ai' | 'rules';
  tips: string[];
}
