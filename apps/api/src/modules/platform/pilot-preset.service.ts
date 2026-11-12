import {
  PILOT_PRESET,
  ROLES,
  resolveFeatures,
  type Feature,
  type Permission,
  type Role,
} from '@campuslink/shared';
import { runInTenant } from '../../lib/context.js';
import { notFound } from '../../lib/errors.js';
import { TenantModel } from '../tenants/tenant.model.js';
import { invalidateTenant, type TenantRecord } from '../tenants/tenant.cache.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';

/**
 * The pilot preset (prompt 4, P11): one college's switches and limits set for a focused first
 * term (`PILOT_PRESET` in packages/shared). It only sets switches and limits that already exist,
 * never deletes anything, and is safe to run again (a second run changes nothing). The command
 * `college:pilot-preset` calls `apply()`; a console button can call it unchanged.
 *
 * What it cannot switch (no switch exists; see docs/build/progress-4.md): voice Q&A (part of Q&A;
 * it needs the Whisper service, which the pilot server does not run) and Campus Captains (a
 * capability an admin grants one member at a time; nobody holds it until then).
 */
export interface PresetChange {
  setting: string;
  from: unknown;
  to: unknown;
}

export interface PresetDeps {
  /** In the college: whether the public outcomes page is on, and switching it off (PublicPagesService). */
  outcomesPageEnabled: () => Promise<boolean>;
  switchOutcomesPageOff: () => Promise<unknown>;
}

/** Roles a college can hold (the platform's and employers' roles are never overridden in a college). */
const COLLEGE_ROLES = ROLES.filter((r) => !['SUPER_ADMIN', 'EMPLOYER_ADMIN', 'RECRUITER'].includes(r));

export class PilotPresetService {
  constructor(private readonly d: PresetDeps) {}

  async apply(
    slug: string,
    opts: { dryRun?: boolean } = {},
    meta: RequestMetaLite = { requestId: 'pilot-preset', ipPrefix: null },
  ): Promise<{ slug: string; dryRun: boolean; changes: PresetChange[] }> {
    const t = await TenantModel.findOne({ slug, kind: 'college' }).lean<TenantRecord>();
    if (!t) throw notFound('College');
    const changes: PresetChange[] = [];
    const set: Record<string, unknown> = {};
    const change = (setting: string, from: unknown, to: unknown, path = setting) => {
      if (JSON.stringify(from) === JSON.stringify(to)) return;
      changes.push({ setting, from, to });
      set[path] = to;
    };

    // Feature switches (what the college chose; its plan still decides what applies).
    const chosen = resolveFeatures(t.features);
    for (const f of PILOT_PRESET.featuresOn as readonly Feature[]) change(`features.${f}`, chosen[f], true);
    for (const f of PILOT_PRESET.featuresOff as readonly Feature[]) change(`features.${f}`, chosen[f], false);

    // Modules without a feature switch: their permissions are revoked from every college role.
    const revoke: Partial<Record<Role, Permission[]>> = { ...(t.permissionOverrides?.revoke ?? {}) };
    const grant: Partial<Record<Role, Permission[]>> = { ...(t.permissionOverrides?.grant ?? {}) };
    const off = PILOT_PRESET.revoke as readonly Permission[];
    for (const role of COLLEGE_ROLES) {
      const before = revoke[role] ?? [];
      const after = [...new Set([...before, ...off])];
      if (after.length !== before.length) {
        changes.push({
          setting: `permissions.revoke.${role}`,
          from: off.filter((p) => before.includes(p)),
          to: [...off],
        });
        revoke[role] = after;
      }
      // A grant would win over the revoke (resolvePermissions), so the same permissions leave it.
      const granted = grant[role] ?? [];
      const kept = granted.filter((p) => !off.includes(p));
      if (kept.length !== granted.length) {
        changes.push({
          setting: `permissions.grant.${role}`,
          from: granted.filter((p) => off.includes(p)),
          to: [],
        });
        grant[role] = kept;
      }
    }
    if (changes.some((c) => c.setting.startsWith('permissions.')))
      set.permissionOverrides = { grant, revoke };

    // The network (ADR 0014): every college switch off.
    for (const k of ['alumniDiscovery', 'employerAccess', 'credentials'] as const)
      change(`network.${k}`, !!t.network?.[k], false);

    // Allowances: a custom deal on top of the plan (only these two terms), and the storage limits.
    // `subscription.terms` may be null, so the merged object is written whole (not a path under null).
    const terms = (t.subscription?.terms ?? {}) as Record<string, unknown>;
    let termsChanged = false;
    for (const [k, v] of Object.entries(PILOT_PRESET.terms)) {
      const from = terms[k] ?? null;
      if (JSON.stringify(from) === JSON.stringify(v)) continue;
      changes.push({ setting: `subscription.terms.${k}`, from, to: v });
      termsChanged = true;
    }
    if (termsChanged) set['subscription.terms'] = { ...terms, ...PILOT_PRESET.terms };
    for (const [k, v] of Object.entries(PILOT_PRESET.limits))
      change(`limits.${k}`, (t.limits as Record<string, unknown> | undefined)?.[k] ?? null, v);

    // The public outcomes page (growth settings, owned by the public-pages module).
    const outcomes = await runInTenant(t._id, () => this.d.outcomesPageEnabled());
    if (outcomes) changes.push({ setting: 'growth.outcomesPage.enabled', from: true, to: false });

    if (opts.dryRun || !changes.length) return { slug, dryRun: !!opts.dryRun, changes };

    if (Object.keys(set).length) await TenantModel.updateOne({ _id: t._id }, { $set: set });
    await runInTenant(t._id, async () => {
      if (outcomes) await this.d.switchOutcomesPageOff();
      await audit.record(
        {
          action: 'platform.pilot_preset_applied',
          targetType: 'tenant',
          targetId: String(t._id),
          // Setting names only (the audit log keeps primitives).
          meta: {
            changed: changes.length,
            settings: changes
              .map((c) => c.setting)
              .join(',')
              .slice(0, 900),
          },
        },
        meta,
      );
    });
    invalidateTenant(t.slug);
    return { slug, dryRun: false, changes };
  }
}
