import {
  APP_NAME,
  ErrorCode,
  PRIVACY_NOTICE_VERSION,
  type LegalDoc,
  type LegalDocView,
  type LegalSettingsBody,
  type LegalSettingsView,
} from '@campuslink/shared';
import { TenantModel } from './tenant.model.js';
import { findTenantById, invalidateTenant, type TenantRecord } from './tenant.cache.js';
import { LEGAL_TEMPLATES } from './legal-templates.js';
import { LEGAL_TRANSLATIONS } from './legal-translations.js';
import { consentService } from '../consent/consent.service.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { AppError } from '../../lib/errors.js';
import { requireTenantId } from '../../lib/context.js';

/**
 * The college's legal pages and notice versions (build B14). The privacy policy and terms are the
 * platform's templates (legal-templates.ts) filled with the college's details. The notice version
 * a member accepts is the platform's `PRIVACY_NOTICE_VERSION`, plus the college's own version once
 * it has published its details (`2026-11-draft+c2`); when either changes, members accept again on
 * their next sign-in. Acceptances are append-only consent records, kept on erasure.
 */
export class LegalService {
  noticeVersion(t: TenantRecord): string {
    const v = t.legal?.version ?? 0;
    return v ? `${PRIVACY_NOTICE_VERSION}+c${v}` : PRIVACY_NOTICE_VERSION;
  }

  /** The notice version of the college in the current request or job. */
  async currentNoticeVersion(): Promise<string> {
    const t = await findTenantById(requireTenantId());
    return t ? this.noticeVersion(t) : PRIVACY_NOTICE_VERSION;
  }

  settings(t: TenantRecord): LegalSettingsView {
    const l = t.legal;
    return {
      legalName: l?.legalName ?? null,
      address: l?.address ?? null,
      grievanceOfficer: l?.grievanceOfficer ?? null,
      version: l?.version ?? 0,
      updatedAt: l?.updatedAt ? new Date(l.updatedAt).toISOString() : null,
    };
  }

  /** Publishes the college's details: a new version that members accept on their next sign-in. */
  async update(t: TenantRecord, actorId: string, body: LegalSettingsBody, meta: RequestMetaLite) {
    const officer = { ...body.grievanceOfficer, phone: body.grievanceOfficer.phone ?? null };
    const fresh = await TenantModel.findOneAndUpdate(
      { _id: t._id },
      {
        $set: {
          'legal.legalName': body.legalName,
          'legal.address': body.address,
          'legal.grievanceOfficer': officer,
          'legal.updatedAt': new Date(),
        },
        $inc: { 'legal.version': 1 },
      },
      { returnDocument: 'after' },
    ).lean<TenantRecord>();
    invalidateTenant(t.slug);
    const next = fresh ?? t;
    await audit.record(
      {
        action: 'tenant.legal_published',
        actorId,
        targetType: 'tenant',
        targetId: String(t._id),
        meta: { version: next.legal?.version ?? 0 },
      },
      meta,
    );
    return this.settings(next);
  }

  /** A published translation for the language, or null (English is then served). */
  translation(lang: string | undefined) {
    const tr = lang === 'te' || lang === 'hi' ? LEGAL_TRANSLATIONS[lang] : null;
    return tr?.reviewed ? { lang: lang as 'te' | 'hi', ...tr } : null;
  }

  doc(t: TenantRecord, doc: LegalDoc, lang?: string): LegalDocView {
    const tr = this.translation(lang);
    const labels = tr?.labels ?? {
      email: 'Email',
      phone: 'Phone',
      noOfficer:
        'The college has not named its grievance officer here yet. Write to the college office meanwhile.',
      noAddress: 'not published yet (ask the college office)',
    };
    const l = t.legal;
    const officer = l?.grievanceOfficer ?? null;
    const legalName = l?.legalName ?? t.billing?.buyer?.legalName ?? t.branding.displayName;
    const address = l?.address ?? t.billing?.buyer?.address ?? null;
    const values: Record<string, string> = {
      app: APP_NAME,
      college: t.branding.displayName,
      legalName,
      address: address ?? labels.noAddress,
      graceDays: String(t.retention?.deletedAccountGraceDays ?? 30),
      version: this.noticeVersion(t),
      officer: officer
        ? `- **${officer.name}**, ${officer.designation}\n- ${labels.email}: ${officer.email}${officer.phone ? `\n- ${labels.phone}: ${officer.phone}` : ''}`
        : labels.noOfficer,
    };
    const tpl = tr ? tr.docs[doc] : LEGAL_TEMPLATES[doc];
    return {
      doc,
      title: tpl.title,
      version: this.noticeVersion(t),
      body: tpl.body.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => values[k] ?? ''),
      complete: !!(l?.legalName && l.address && officer),
      grievanceOfficer: officer,
      language: tr?.lang ?? 'en',
      translated: !!tr,
    };
  }

  /** Whether the member accepted the current notice (no record at all counts as accepted: such accounts predate consent records). */
  async noticeState(t: TenantRecord, userId: string): Promise<{ version: string; accepted: boolean }> {
    const version = this.noticeVersion(t);
    const latest = await consentService.latestNoticeVersion(userId);
    return { version, accepted: latest === null || latest === version };
  }

  /** The notice state of a member of the college in the current request. */
  async noticeStateForCurrent(userId: string): Promise<{ version: string; accepted: boolean }> {
    const t = await findTenantById(requireTenantId());
    if (!t) return { version: PRIVACY_NOTICE_VERSION, accepted: true };
    return this.noticeState(t, userId);
  }

  async accept(t: TenantRecord, userId: string, version: string, meta: RequestMetaLite) {
    const current = this.noticeVersion(t);
    if (version !== current)
      throw new AppError(409, ErrorCode.CONFLICT, 'The policy changed again; read the latest version.');
    await consentService.recordNotice(userId, current);
    await audit.record(
      { action: 'consent.notice_accepted', actorId: userId, targetType: 'consent', targetId: current },
      meta,
    );
    return { version: current, accepted: true };
  }
}
