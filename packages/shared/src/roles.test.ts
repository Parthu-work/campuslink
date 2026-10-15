import { describe, expect, it } from 'vitest';
import {
  resolvePermissions,
  ROLE_PERMISSIONS,
  PLATFORM_PERMISSIONS,
  TENANT_ROLES,
  UNVERIFIED_PERMISSIONS,
} from './roles.js';

describe('resolvePermissions', () => {
  it('admins without MFA have nothing', () => {
    expect(resolvePermissions({ roles: ['COLLEGE_ADMIN'], verified: true, mfaEnabled: false }).size).toBe(0);
  });
  it('unverified users are limited to the read-only set', () => {
    const p = resolvePermissions({ roles: ['ALUMNI'], verified: false, mfaEnabled: false });
    expect([...p].sort()).toEqual([...UNVERIFIED_PERMISSIONS].sort());
  });
  it('applies grants and revokes per role, never platform permissions', () => {
    const p = resolvePermissions(
      { roles: ['STUDENT'], verified: true, mfaEnabled: false },
      { grant: { STUDENT: ['feed:post', 'platform:tenants'] }, revoke: { STUDENT: ['jobs:save'] } },
    );
    expect(p.has('feed:post')).toBe(true);
    expect(p.has('jobs:save')).toBe(false);
    expect(p.has('platform:tenants')).toBe(false);
  });
  it('capabilities add permissions', () => {
    expect(
      resolvePermissions({
        roles: ['STUDENT'],
        capabilities: ['CERTIFIED_CONTRIBUTOR'],
        verified: true,
        mfaEnabled: false,
      }).has('roadmaps:write'),
    ).toBe(true);
  });
  it('no college role holds a platform permission by default', () => {
    for (const r of TENANT_ROLES)
      expect(ROLE_PERMISSIONS[r].some((p) => PLATFORM_PERMISSIONS.includes(p))).toBe(false);
  });
});
