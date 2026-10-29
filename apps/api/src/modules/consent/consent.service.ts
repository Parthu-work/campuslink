import { Types } from 'mongoose';
import {
  CONSENT_PURPOSES,
  CONSENT_PURPOSE_KEYS,
  GUARDIAN_CONSENT,
  PRIVACY_NOTICE_VERSION,
  type ConsentPurpose,
} from '@campuslink/shared';
import { ConsentModel } from './consent.model.js';
import { badRequest } from '../../lib/errors.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';

export interface ConsentState {
  purpose: ConsentPurpose;
  granted: boolean;
  version: number;
  currentVersion: number;
  required: boolean;
  updatedAt: Date | null;
}

export const consentService = {
  async recordMany(
    userId: Types.ObjectId,
    granted: ConsentPurpose[],
    source: 'signup' | 'settings',
  ): Promise<void> {
    await ConsentModel.insertMany(
      CONSENT_PURPOSE_KEYS.map((purpose) => ({
        userId,
        purpose,
        version: CONSENT_PURPOSES[purpose].version,
        noticeVersion: PRIVACY_NOTICE_VERSION,
        granted: granted.includes(purpose),
        source,
      })),
    );
  },

  /** A guardian confirmed the declaration for a member under 18 (append-only, kept on erasure). */
  async recordGuardian(
    userId: Types.ObjectId | string,
    evidence: { whitelistId: Types.ObjectId; language: string; channel: string },
  ): Promise<void> {
    await ConsentModel.create({
      userId: new Types.ObjectId(String(userId)),
      purpose: GUARDIAN_CONSENT.purpose,
      version: GUARDIAN_CONSENT.version,
      noticeVersion: PRIVACY_NOTICE_VERSION,
      granted: true,
      source: 'guardian',
      evidence,
    });
  },

  /** Guardian consent records for a member (data export). */
  async guardianFor(userId: string) {
    return ConsentModel.find({ userId: new Types.ObjectId(userId), purpose: GUARDIAN_CONSENT.purpose })
      .select('version noticeVersion createdAt evidence.language evidence.channel')
      .lean();
  },

  async current(userId: string): Promise<ConsentState[]> {
    const latest = await ConsentModel.aggregate<{
      _id: ConsentPurpose;
      granted: boolean;
      version: number;
      at: Date;
    }>([
      { $match: { userId: new Types.ObjectId(userId) } },
      { $sort: { _id: -1 } },
      {
        $group: {
          _id: '$purpose',
          granted: { $first: '$granted' },
          version: { $first: '$version' },
          at: { $first: '$createdAt' },
        },
      },
    ]);
    const byPurpose = new Map(latest.map((l) => [l._id, l]));
    return CONSENT_PURPOSE_KEYS.map((purpose) => {
      const l = byPurpose.get(purpose);
      return {
        purpose,
        granted: l?.granted ?? false,
        version: l?.version ?? 0,
        currentVersion: CONSENT_PURPOSES[purpose].version,
        required: CONSENT_PURPOSES[purpose].required,
        updatedAt: l?.at ?? null,
      };
    });
  },

  async set(
    userId: string,
    purpose: ConsentPurpose,
    granted: boolean,
    req: RequestMetaLite,
  ): Promise<ConsentState[]> {
    if (CONSENT_PURPOSES[purpose].required && !granted) {
      throw badRequest(
        'This consent is needed to run your account. To withdraw it, request account deletion instead.',
      );
    }
    await ConsentModel.create({
      userId: new Types.ObjectId(userId),
      purpose,
      version: CONSENT_PURPOSES[purpose].version,
      noticeVersion: PRIVACY_NOTICE_VERSION,
      granted,
      source: 'settings',
    });
    await audit.record(
      {
        action: granted ? 'consent.granted' : 'consent.withdrawn',
        actorId: userId,
        targetType: 'consent',
        targetId: purpose,
      },
      req,
    );
    return this.current(userId);
  },
};
