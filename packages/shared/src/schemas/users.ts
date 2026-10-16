import { z } from 'zod';
import { CAPABILITIES, TENANT_ROLES, type Capability, type Role } from '../roles.js';
import { CONSENT_PURPOSE_KEYS, type ConsentPurpose } from '../consent.js';
import { personName } from './common.js';

export const updateRolesBody = z.strictObject({
  roles: z
    .array(z.enum(TENANT_ROLES as [Role, ...Role[]]))
    .min(1)
    .max(4),
});
export const updateCapabilitiesBody = z.strictObject({
  capabilities: z.array(z.enum(CAPABILITIES as [Capability, ...Capability[]])).max(4),
});
export const updateStatusBody = z.strictObject({ status: z.enum(['active', 'suspended']) });
export const updateMeBody = z.strictObject({
  name: personName.optional(),
  locale: z.enum(['en', 'te']).optional(),
});
export const consentBody = z.strictObject({
  purpose: z.enum(CONSENT_PURPOSE_KEYS as [ConsentPurpose, ...ConsentPurpose[]]),
  granted: z.boolean(),
});
export const listUsersQuery = z.strictObject({
  cursor: z
    .string()
    .regex(/^[a-f0-9]{24}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  q: z.string().trim().max(80).optional(),
  role: z.enum(TENANT_ROLES as [Role, ...Role[]]).optional(),
});

export interface MeResponse {
  id: string;
  /** Set while the member's account deletion is pending (they keep no permissions). */
  deletionPurgeAt?: string | null;
  name: string;
  email: string;
  roles: Role[];
  capabilities: Capability[];
  verified: boolean;
  mfaEnabled: boolean;
  mfaRequired: boolean;
  locale: 'en' | 'te';
  permissions: string[];
}
