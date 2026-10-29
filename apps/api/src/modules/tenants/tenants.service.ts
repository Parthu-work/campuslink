import { Types } from 'mongoose';
import {
  APP_NAME,
  generatePalette,
  type Branding,
  type PublicBotCheck,
  type PublicTenant,
  type Feature,
  resolveFeatures,
} from '@campuslink/shared';
import { TenantModel } from './tenant.model.js';
import type { FilesService } from '../files/files.service.js';
import { invalidateTenant, type TenantRecord } from './tenant.cache.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { notFound } from '../../lib/errors.js';
import type { z } from 'zod';
import type { tenantSettingsBody } from '@campuslink/shared';

export const toPublicTenant = (
  t: TenantRecord,
  botCheck: PublicBotCheck | null = null,
  phoneSignIn = false,
): PublicTenant => ({
  slug: t.slug,
  kind: t.kind,
  status: t.status,
  branding: t.branding,
  // The file id in the link makes a replaced logo a new URL, so caches never show the old one.
  logoUrl: t.logo?.fileId ? `/api/v1/tenant/logo?v=${String(t.logo.fileId)}` : null,
  features: resolveFeatures(t.features),
  botCheck,
  phoneSignIn,
});

/** The app's own icons (apps/web/public/icons), used when a college has no logo and alongside it. */
const APP_ICONS = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
];

/**
 * The installed app's manifest (audit PW-3, VI-3; decision 7): each college installs under its own
 * name and canvas colour, with its logo as the icon once it has one, so two colleges on
 * one phone are two different apps. The platform console keeps the product's name.
 */
export function webManifest(t: TenantRecord) {
  const college = t.kind === 'college';
  const chrome = generatePalette({ primary: t.branding.primary, accent: t.branding.accent }).chrome;
  const logo = college ? toPublicTenant(t).logoUrl : null;
  return {
    id: '/',
    name: college ? t.branding.displayName : APP_NAME,
    short_name: college ? t.branding.shortName : APP_NAME,
    description: 'Guidance from your own college.',
    lang: 'en',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: chrome.dark,
    background_color: chrome.dark,
    // With a logo, nothing that a launcher could prefer over it (the app's SVG or maskable icon);
    // the 192 px app icon stays because installing needs one at that size.
    icons: logo
      ? [{ src: logo, sizes: '512x512', type: 'image/webp', purpose: 'any' }, APP_ICONS[0]]
      : APP_ICONS,
  };
}

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

  /** Replaces the college logo (the old file is deleted); recorded in the audit log. */
  async setLogo(
    files: FilesService,
    tenant: TenantRecord,
    actorId: string,
    data: Buffer,
    meta: RequestMetaLite,
  ) {
    const file = await files.storeLogo(data);
    const fileId = new Types.ObjectId(file.id);
    const before = await TenantModel.findOneAndUpdate(
      { _id: tenant._id },
      { $set: { 'logo.fileId': fileId } },
      { returnDocument: 'before' },
    ).lean<TenantRecord>();
    const old = before?.logo?.fileId;
    if (old) await files.remove(old);
    invalidateTenant(tenant.slug);
    await audit.record(
      {
        action: 'tenant.logo_changed',
        actorId,
        targetType: 'tenant',
        targetId: String(tenant._id),
        meta: { size: file.size },
      },
      meta,
    );
    return toPublicTenant({ ...tenant, logo: { fileId } });
  },

  /** Back to the monogram. */
  async removeLogo(files: FilesService, tenant: TenantRecord, actorId: string, meta: RequestMetaLite) {
    const before = await TenantModel.findOneAndUpdate(
      { _id: tenant._id },
      { $set: { 'logo.fileId': null } },
      { returnDocument: 'before' },
    ).lean<TenantRecord>();
    const old = before?.logo?.fileId;
    if (old) {
      await files.remove(old);
      await audit.record(
        { action: 'tenant.logo_removed', actorId, targetType: 'tenant', targetId: String(tenant._id) },
        meta,
      );
    }
    invalidateTenant(tenant.slug);
    return toPublicTenant({ ...tenant, logo: { fileId: null } });
  },

  async settings(tenant: TenantRecord) {
    return {
      features: resolveFeatures(tenant.features),
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
