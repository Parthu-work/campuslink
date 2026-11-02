import 'http';
import type { Permission, Role, Capability } from '@campuslink/shared';
import type { TenantRecord } from './modules/tenants/tenant.cache.js';

export interface AuthState {
  userId: string;
  sessionId: string;
  roles: Role[];
  capabilities: Capability[];
  verified: boolean;
  mfaEnabled: boolean;
  mfaPending: boolean;
  /** Under 18 and waiting for a guardian's consent: no permissions at all (B2). */
  guardianPending?: boolean;
  /** Under 18 (with consent): ranking, contact details and leaderboards work differently (B2). */
  minor?: boolean;
  permissions: Set<Permission>;
}

declare module 'http' {
  interface IncomingMessage {
    id: string;
    tenant?: TenantRecord;
    auth?: AuthState;
  }
}
