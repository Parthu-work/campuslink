import type { PlatformAiPrices } from '@campuslink/shared';
import { runInTenant } from '../../lib/context.js';
import { TenantModel } from '../tenants/tenant.model.js';
import { findTenantById } from '../tenants/tenant.cache.js';
import type { EntitlementsService } from './entitlements.js';

/**
 * The cost report (prompt 4, P5): what the platform's pay-per-use services cost this month, per
 * college, each figure beside its allowance, cap or free-tier limit. Aggregates only: tokens,
 * message counts and bytes, never a member, a message or a file name. The command
 * `costs:report` prints it; a console panel can call `report()` unchanged (handover to prompt 3).
 */
export interface CostRates {
  /** What one WhatsApp message costs the platform, in paise (an estimate; null: not set). */
  whatsappPaise: number | null;
  /** What one SMS costs the platform, in paise (an estimate; null: not set). */
  smsPaise: number | null;
  /** Rupees per US dollar, for AI prices kept in dollars (null: not set). */
  usdInr: number | null;
}

/** What the nightly backup wrote about itself (deploy/prod/backup.sh → backup-status.json). */
export interface BackupStatus {
  at: string;
  ok: boolean;
  /** Bytes the off-site bucket holds after the run (database archives plus the encrypted file copy). */
  remoteBytes: number;
}

export interface CollegeCosts {
  slug: string;
  ai: {
    /** Tokens served by the platform's key (the ones the platform pays for). */
    platformTokens: number;
    /** Tokens on the college's own key (the college pays its provider; shown for completeness). */
    ownTokens: number;
    /** The plan's monthly allowance on the platform's key (enforced in AiSettingsService.runtime). */
    allowanceTokens: number;
    estimate: number | null;
    currency: string;
    estimatePaise: number | null;
  };
  whatsapp: { messages: number; allowance: number; estimatePaise: number | null };
  sms: { messages: number; estimatePaise: number | null };
  storage: { bytes: number; limitBytes: number | null };
}

export interface CostReport {
  month: string;
  generatedAt: string;
  colleges: CollegeCosts[];
  totals: {
    aiPlatformTokens: number;
    whatsappMessages: number;
    smsMessages: number;
    storageBytes: number;
    /** Everything priced, in paise; null when a used service has no price set. */
    estimatePaise: number | null;
  };
  backup: { status: BackupStatus | null; freeTierBytes: number; alertBytes: number };
  rates: CostRates & { ai: PlatformAiPrices };
}

export interface CostsDeps {
  entitlements: EntitlementsService;
  /** In the current college: the month's tokens by price class (AiUsageService). */
  aiTokens: (
    month: string,
  ) => Promise<{ chatInput: number; chatOutput: number; embedding: number; own: number }>;
  /** In the current college: the month's messages by channel (ChannelService). */
  channelCounts: (month: string) => Promise<{ whatsapp: number; sms: number }>;
  /** In the current college: bytes stored (FilesService). */
  storedBytes: () => Promise<number>;
  /** What the platform pays per million tokens (BillingService: saved prices, else env). */
  aiPrices: () => Promise<PlatformAiPrices>;
  rates: CostRates;
}

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Cloudflare R2's free tier: 10 GB-month of storage (checked 10 Nov 2026). The alert fires at 8. */
export const R2_FREE_BYTES = 10 * 1024 ** 3;
export const R2_ALERT_BYTES = 8 * 1024 ** 3;

export class CostsService {
  constructor(private readonly d: CostsDeps) {}

  /** One college's month, inside its tenant context. */
  async college(slug: string, month: string, prices: PlatformAiPrices): Promise<CollegeCosts | null> {
    const t = await TenantModel.findOne({ slug, kind: 'college' }).select('_id').lean();
    const tenant = t ? await findTenantById(t._id) : null;
    if (!tenant) return null;
    const { rates, entitlements } = this.d;
    return runInTenant(tenant._id, async () => {
      const [tokens, counts, bytes] = await Promise.all([
        this.d.aiTokens(month),
        this.d.channelCounts(month),
        this.d.storedBytes(),
      ]);
      const platformTokens = tokens.chatInput + tokens.chatOutput + tokens.embedding;
      const priced = prices.input !== null || prices.output !== null || prices.embedding !== null;
      const estimate = priced
        ? Math.round(
            ((tokens.chatInput * (prices.input ?? 0) +
              tokens.chatOutput * (prices.output ?? 0) +
              tokens.embedding * (prices.embedding ?? 0)) /
              1_000_000) *
              100,
          ) / 100
        : platformTokens === 0
          ? 0
          : null;
      const toPaise =
        estimate === null
          ? null
          : prices.currency === 'INR'
            ? Math.round(estimate * 100)
            : prices.currency === 'USD' && rates.usdInr !== null
              ? Math.round(estimate * rates.usdInr * 100)
              : estimate === 0
                ? 0
                : null;
      const per = (n: number, paise: number | null) => (n === 0 ? 0 : paise === null ? null : n * paise);
      const storageMb = entitlements.limit(tenant, 'storageMb');
      return {
        slug: tenant.slug,
        ai: {
          platformTokens,
          ownTokens: tokens.own,
          allowanceTokens: entitlements.limit(tenant, 'aiTokens'),
          estimate,
          currency: prices.currency,
          estimatePaise: toPaise,
        },
        whatsapp: {
          messages: counts.whatsapp,
          allowance: entitlements.limit(tenant, 'whatsapp'),
          estimatePaise: per(counts.whatsapp, rates.whatsappPaise),
        },
        sms: { messages: counts.sms, estimatePaise: per(counts.sms, rates.smsPaise) },
        storage: { bytes, limitBytes: storageMb > 0 ? storageMb * 1048576 : null },
      };
    });
  }

  /** Every college (suspended ones too: their files still take space), and the totals. */
  async report(month: string, backup: BackupStatus | null = null, now = new Date()): Promise<CostReport> {
    if (!MONTH.test(month)) throw new Error('The month looks like 2026-11');
    const prices = await this.d.aiPrices();
    const slugs = await TenantModel.find({ kind: 'college' }).select('slug').sort({ slug: 1 }).lean();
    const colleges: CollegeCosts[] = [];
    for (const { slug } of slugs) {
      const c = await this.college(slug, month, prices);
      if (c) colleges.push(c);
    }
    const sum = (f: (c: CollegeCosts) => number) => colleges.reduce((n, c) => n + f(c), 0);
    const parts = colleges.flatMap((c) => [
      c.ai.estimatePaise,
      c.whatsapp.estimatePaise,
      c.sms.estimatePaise,
    ]);
    return {
      month,
      generatedAt: now.toISOString(),
      colleges,
      totals: {
        aiPlatformTokens: sum((c) => c.ai.platformTokens),
        whatsappMessages: sum((c) => c.whatsapp.messages),
        smsMessages: sum((c) => c.sms.messages),
        storageBytes: sum((c) => c.storage.bytes),
        estimatePaise: parts.some((p) => p === null) ? null : parts.reduce<number>((n, p) => n + (p ?? 0), 0),
      },
      backup: { status: backup, freeTierBytes: R2_FREE_BYTES, alertBytes: R2_ALERT_BYTES },
      rates: {
        ...this.d.rates,
        ai: {
          input: prices.input,
          output: prices.output,
          embedding: prices.embedding,
          currency: prices.currency,
        },
      },
    };
  }
}
