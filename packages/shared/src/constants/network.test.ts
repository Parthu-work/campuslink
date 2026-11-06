import { describe, expect, it } from 'vitest';
import {
  EMPLOYER_PERMISSIONS,
  NETWORK_PATHS,
  Role,
  ROLE_PERMISSIONS,
  TENANT_ROLES,
  buildNav,
  gstinCheckDigit,
  homePath,
  isFreeMailDomain,
  isValidGstin,
  navPersona,
  poolCount,
  requiresMfa,
  resolvePermissions,
} from '../index.js';

describe('the network constants (ADR 0014)', () => {
  it('checks GSTIN shape, state code and check digit (N24)', () => {
    const body = '27AAPFU0939F1Z';
    const good = body + gstinCheckDigit(body);
    expect(isValidGstin(good)).toBe(true);
    expect(isValidGstin(good.toLowerCase())).toBe(true);
    const wrong = body + (gstinCheckDigit(body) === 'A' ? 'B' : 'A');
    expect(isValidGstin(wrong)).toBe(false);
    expect(isValidGstin('99AAPFU0939F1Z' + gstinCheckDigit('99AAPFU0939F1Z'))).toBe(false);
    expect(isValidGstin('27AAPFU0939F1')).toBe(false);
    expect(isValidGstin('')).toBe(false);
  });

  it('refuses free mail and disposable domains (N23)', () => {
    for (const d of ['gmail.com', 'yahoo.co.uk', 'hotmail.fr', 'rediffmail.com', 'proton.me', 'yopmail.com'])
      expect(isFreeMailDomain(d)).toBe(true);
    expect(isFreeMailDomain('acme.example')).toBe(false);
  });

  it('suppresses and rounds pool counts (N29)', () => {
    expect(poolCount(0)).toBe(0);
    expect(poolCount(1)).toBe('<5');
    expect(poolCount(4)).toBe('<5');
    expect(poolCount(5)).toBe(5);
    expect(poolCount(9)).toBe(5);
    expect(poolCount(23)).toBe(20);
  });

  it('has a closed list of named paths in the platform scope format', () => {
    expect(new Set(NETWORK_PATHS).size).toBe(17);
    for (const p of NETWORK_PATHS) expect(p).toMatch(/^network:[a-z-]+$/);
  });

  it('keeps employer roles out of colleges and requires TOTP for them (N3)', () => {
    expect(TENANT_ROLES).not.toContain(Role.EMPLOYER_ADMIN);
    expect(TENANT_ROLES).not.toContain(Role.RECRUITER);
    expect(requiresMfa([Role.RECRUITER])).toBe(true);
    expect(requiresMfa([Role.EMPLOYER_ADMIN])).toBe(true);
    expect(resolvePermissions({ roles: [Role.RECRUITER], verified: true, mfaEnabled: false }).size).toBe(0);
    for (const p of EMPLOYER_PERMISSIONS) {
      expect(ROLE_PERMISSIONS.COLLEGE_ADMIN).not.toContain(p);
      expect(ROLE_PERMISSIONS.TPO).not.toContain(p);
    }
    expect(ROLE_PERMISSIONS.STUDENT).toContain('network:discover');
    expect(ROLE_PERMISSIONS.ALUMNI).toContain('network:discover');
    expect(ROLE_PERMISSIONS.FACULTY).not.toContain('network:discover');
    expect(ROLE_PERMISSIONS.TPO).toContain('network:manage');
  });

  it('gives recruiters their own tabs and landing', () => {
    expect(navPersona([Role.RECRUITER])).toBe('employer');
    expect(homePath([Role.EMPLOYER_ADMIN])).toBe('/recruiter');
    const perms = [...resolvePermissions({ roles: [Role.EMPLOYER_ADMIN], verified: true, mfaEnabled: true })];
    const nav = buildNav(
      { roles: [Role.EMPLOYER_ADMIN], permissions: perms, verified: true },
      new Set(['recruiter', 'notifications', 'help', 'settings', 'home']),
    );
    expect(nav.tabs.map((t) => t.id)).toEqual(['recruiter', 'notifications', 'help', 'settings']);
    expect(nav.admin).toEqual([]);
  });
});
