import type { Permission, PermissionOverrides, Role } from '@campuslink/shared';
import { ROLES } from '@campuslink/shared';

/**
 * The platform's switch for the network (prompt 4, P0; `NETWORK_ENABLED`, ADR 0014). While it is
 * off: employer hosts do not resolve (404), the network, employer and credential modules answer
 * 404, nobody holds a network permission (so navigation hides every network destination), and the
 * reconcile timer does not run. Nothing is deleted. Set once by `createApp` from the environment.
 */
let enabled = true;
export const setNetworkEnabled = (on: boolean): void => {
  enabled = on;
};
export const networkEnabled = (): boolean => enabled;

/** The modules that exist only for the network (`defineModule` names). */
export const NETWORK_MODULES: ReadonlySet<string> = new Set([
  'network',
  'employers',
  'credentials',
  'credentials-public',
]);

export const NETWORK_PERMISSIONS: readonly Permission[] = [
  'network:discover',
  'network:manage',
  'credentials:own',
  'credentials:manage',
  'employer:post',
  'employer:candidates',
  'employer:manage',
  'platform:employers',
];

/** A college's overrides with every network permission revoked from every role (the switch is off). */
export function withoutNetwork(overrides: PermissionOverrides = {}): PermissionOverrides {
  const revoke: Partial<Record<Role, Permission[]>> = { ...(overrides.revoke ?? {}) };
  for (const role of ROLES) revoke[role] = [...new Set([...(revoke[role] ?? []), ...NETWORK_PERMISSIONS])];
  // A grant is applied after a revoke (resolvePermissions), so network grants are dropped too.
  const grant: Partial<Record<Role, Permission[]>> = {};
  for (const [role, list] of Object.entries(overrides.grant ?? {}) as [Role, Permission[]][])
    grant[role] = list.filter((p) => !NETWORK_PERMISSIONS.includes(p));
  return { ...overrides, revoke, grant };
}
