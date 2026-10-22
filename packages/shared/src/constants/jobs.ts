/**
 * Jobs vocabulary and limits.
 * Zod-free on purpose: screens that only need these values never load Zod (bundle budget).
 */
export const JOB_MODES = ['remote', 'hybrid', 'onsite'] as const;
export type JobMode = (typeof JOB_MODES)[number];
export const JOB_TYPES = ['full_time', 'internship', 'contract', 'part_time'] as const;
export type JobType = (typeof JOB_TYPES)[number];
/** fresher ≈ 0–1 years, junior ≈ 1–3, mid ≈ 3–6, senior ≈ 6+. */
export const JOB_LEVELS = ['fresher', 'junior', 'mid', 'senior'] as const;
export type JobLevel = (typeof JOB_LEVELS)[number];
export const TRACK_STATUSES = ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn'] as const;
export type TrackStatus = (typeof TRACK_STATUSES)[number];
export const JOB_SOURCE_KINDS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'adzuna', 'rss'] as const;
export type JobSourceKind = (typeof JOB_SOURCE_KINDS)[number];
export const REFERRAL_STATUSES = ['pending', 'referred', 'declined', 'expired', 'withdrawn'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
export const REFERRAL_DECLINE_TEMPLATES = ['not_a_fit', 'no_openings', 'cap_reached', 'other'] as const;
export const REFERRAL_TTL_DAYS = 14;
export const MAX_OPEN_REFERRALS = 3;
export const MAX_JOB_ALERTS = 5;
export const JOB_DESCRIPTION_MAX = 5000;
