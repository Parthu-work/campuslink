import type { Branding, PublicBotCheck, PublicTenant, Feature } from '@campuslink/shared';
import { TenantModel } from './tenant.model.js';
import { invalidateTenant, type TenantRecord } from './tenant.cache.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { notFound } from '../../lib/errors.js';
import type { z } from 'zod';
import type { tenantSettingsBody } from '@campuslink/shared';

export const toPublicTenant = (t: TenantRecord, botCheck: PublicBotCheck | null = null): PublicTenant => ({
  slug: t.slug,
  kind: t.kind,
  status: t.status,
  branding: t.branding,
  features: t.features,
  botCheck,
});

export const tenantsService = {
  async updateBranding(tenant: TenantRecord, actorId: string, branding: Branding, meta: RequestMetaLite) {
    await TenantModel.updateOne({ _id: tenant._id }, { $set: { branding } });
    invalidateTenant(tenant.slug);
    await audit.record(
      {
        action: 'tenant.branding_changed',
        actorId,
        targetType: 'tenant',
        targetId: String(tenant._id),
        meta: { primary: branding.primary, accent: branding.accent },
      },
      meta,
    );
    return toPublicTenant({ ...tenant, branding });
  },

  async settings(tenant: TenantRecord) {
    return {
      features: tenant.features,
      allowedEmailDomains: tenant.allowedEmailDomains,
      limits: tenant.limits,
      permissionOverrides: tenant.permissionOverrides,
    };
  },

  async updateSettings(
    tenant: TenantRecord,
    actorId: string,
    body: z.output<typeof tenantSettingsBody>,
    meta: RequestMetaLite,
  ) {
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.features ?? {})) set[`features.${k as Feature}`] = v;
    for (const [k, v] of Object.entries(body.limits ?? {})) set[`limits.${k}`] = v;
    if (body.allowedEmailDomains) set.allowedEmailDomains = [...new Set(body.allowedEmailDomains)];
    if (body.permissionOverrides)
      set.permissionOverrides = {
        grant: body.permissionOverrides.grant ?? {},
        revoke: body.permissionOverrides.revoke ?? {},
      };
    const updated = await TenantModel.findOneAndUpdate(
      { _id: tenant._id },
      { $set: set },
      { returnDocument: 'after' },
    ).lean<TenantRecord>();
    invalidateTenant(tenant.slug);
    await audit.record(
      {
        action: body.permissionOverrides ? 'tenant.permissions_changed' : 'tenant.settings_changed',
        actorId,
        targetType: 'tenant',
        targetId: String(tenant._id),
        meta: { fields: Object.keys(set) },
      },
      meta,
    );
    if (!updated) throw notFound('College');
    return this.settings(updated);
  },
};
