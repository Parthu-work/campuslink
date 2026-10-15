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
  permissions: Set<Permission>;
}

declare module 'http' {
  interface IncomingMessage {
    id: string;
    tenant?: TenantRecord;
    auth?: AuthState;
  }
}
