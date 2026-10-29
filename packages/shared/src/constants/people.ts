/**
 * People vocabulary: branches, import fields and profile visibility.
 * Zod-free on purpose: screens that only need these values never load Zod (bundle budget).
 */
export const BRANCHES = ['CSE', 'IT', 'ECE', 'EEE', 'MECH', 'CIVIL', 'CHEM', 'AIML', 'DS', 'OTHER'] as const;
export type Branch = (typeof BRANCHES)[number];
export const IMPORT_FIELDS = [
  'rollNumber',
  'name',
  'branch',
  'gradYear',
  'email',
  'phone',
  'kind',
  /** The parent or guardian's mobile from the admission record (guardian consent for minors). */
  'guardianPhone',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const REQUIRED_IMPORT_FIELDS: readonly ImportField[] = ['rollNumber', 'name'];
export const AUDIENCES = ['members', 'alumni_staff', 'only_me'] as const;
export type Audience = (typeof AUDIENCES)[number];
export const PROFILE_FIELDS = [
  'headline',
  'company',
  'jobTitle',
  'location',
  'skills',
  'topics',
  'languages',
  'bio',
  'links',
  'email',
  'phone',
  'branch',
  'gradYear',
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export const DEFAULT_VISIBILITY: Record<ProfileField, Audience> = {
  headline: 'members',
  company: 'members',
  jobTitle: 'members',
  location: 'members',
  skills: 'members',
  topics: 'members',
  languages: 'members',
  bio: 'members',
  links: 'members',
  branch: 'members',
  gradYear: 'members',
  email: 'only_me',
  phone: 'only_me',
};
