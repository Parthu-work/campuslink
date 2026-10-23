import { z } from 'zod';
import { HEX_COLOR } from '../color.js';
import { tenantSlug, email, personName } from './common.js';
import { ALL_PERMISSIONS, PLATFORM_PERMISSIONS, TENANT_ROLES } from '../roles.js';

const hex = z
  .string()
  .regex(HEX_COLOR, 'Use a #rrggbb colour')
  .transform((v) => v.toLowerCase());

export const brandingSchema = z.strictObject({
  displayName: z.string().trim().min(3).max(100),
  shortName: z.string().trim().min(2).max(12),
  primary: hex,
  secondary: hex,
  accent: hex,
  /** Shown when the college has no logo (and in small places, like the platform console). */
  monogram: z
    .string()
    .trim()
    .min(1)
    .max(3)
    .regex(/^[A-Za-z0-9]+$/),
  city: z.string().trim().max(60).optional(),
});
export type Branding = z.infer<typeof brandingSchema>;

/** The college logo: PNG or WebP (never SVG), at most 512 KB; stored re-encoded at most 512 px. */
export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_TYPES = ['image/png', 'image/webp'] as const;

export const FEATURES = {
  studentPosting: 'Students can publish feed posts',
  stories: 'Stories and Tips reels',
  leaderboards: 'Opt-in leaderboards',
  alumniMatch: 'Swipe-style Alumni Match',
  jobsAggregation: 'Automated job sources',
} as const;
export type Feature = keyof typeof FEATURES;
const featureKeys = Object.keys(FEATURES) as [Feature, ...Feature[]];

const grantablePermission = z
  .enum(ALL_PERMISSIONS)
  .refine(
    (p) => !PLATFORM_PERMISSIONS.includes(p),
    'Platform permissions cannot be granted to a college role',
  );
const roleMap = z.partialRecord(
  z.enum(TENANT_ROLES as [string, ...string[]]),
  z.array(grantablePermission).max(60),
);

export const tenantSettingsBody = z.strictObject({
  features: z.partialRecord(z.enum(featureKeys), z.boolean()).optional(),
  allowedEmailDomains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
    )
    .max(20)
    .optional(),
  limits: z
    .strictObject({
      mentorshipRequestsPerWeek: z.number().int().min(1).max(50),
      referralRequestsPerWeek: z.number().int().min(1).max(20),
    })
    .partial()
    .optional(),
  permissionOverrides: z.strictObject({ grant: roleMap.optional(), revoke: roleMap.optional() }).optional(),
});

export const subscriptionSchema = z.strictObject({
  plan: z.enum(['trial', 'standard', 'premium']),
  seatLimit: z.number().int().min(10).max(100_000),
  renewalDate: z.iso.date().nullable(),
});

export const createTenantBody = z.strictObject({
  slug: tenantSlug.refine((s) => !['admin', 'www', 'api', 'app', 'mail'].includes(s), 'Reserved name'),
  branding: brandingSchema,
  subscription: subscriptionSchema,
  firstAdmin: z.strictObject({ name: personName, email }),
});
export const updateTenantBody = z.strictObject({
  status: z.enum(['active', 'suspended']).optional(),
  subscription: subscriptionSchema.partial().optional(),
});

/** Human check the web app runs when the API answers BOT_CHECK_FAILED (null when it is off). */
export interface PublicBotCheck {
  provider: 'turnstile';
  /** Public site key (not a secret). */
  siteKey: string;
}

export interface PublicTenant {
  slug: string;
  kind: 'college' | 'platform';
  status: 'active' | 'suspended';
  branding: Branding;
  /** The uploaded logo (changes when it is replaced), or null for the monogram. */
  logoUrl: string | null;
  features: Record<Feature, boolean>;
  botCheck: PublicBotCheck | null;
}
