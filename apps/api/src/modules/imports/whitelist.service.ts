import { Types } from 'mongoose';
import type { z } from 'zod';
import type { whitelistRecordBody } from '@campuslink/shared';
import { WhitelistModel } from './whitelist.model.js';
import type { FieldCipher } from '../../lib/crypto.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(3, Math.min(local.length - 1, 6)))}@${domain}`;
}

export class WhitelistService {
  constructor(private readonly cipher: FieldCipher) {}

  async list(q: {
    q?: string | undefined;
    status?: 'unclaimed' | 'claimed' | undefined;
    cursor?: string | undefined;
    limit: number;
  }) {
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    if (q.cursor) filter._id = { $lt: new Types.ObjectId(q.cursor) };
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      filter.$or = [{ rollNumber: rx }, { name: rx }];
    }
    const rows = await WhitelistModel.find(filter)
      .sort({ _id: -1 })
      .limit(q.limit + 1)
      .lean();
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((r) => ({
        id: String(r._id),
        rollNumber: r.rollNumber,
        name: r.name,
        branch: r.branch,
        gradYear: r.gradYear,
        kind: r.kind,
        status: r.status,
        source: r.source,
        // Admins see masked contact only: enough to recognise, not to harvest.
        email: r.emailEnc ? maskEmail(this.cipher.decrypt(r.emailEnc)) : null,
        hasPhone: !!r.phoneEnc,
      })),
      nextCursor: rows.length > q.limit ? String(page.at(-1)?._id) : null,
    };
  }

  async add(actorId: string, body: z.output<typeof whitelistRecordBody>, meta: RequestMetaLite) {
    if (await WhitelistModel.exists({ rollNumber: body.rollNumber }))
      throw conflict('That roll number is already on the list');
    const rec = await WhitelistModel.create({
      rollNumber: body.rollNumber,
      name: body.name,
      branch: body.branch ?? null,
      gradYear: body.gradYear ?? null,
      kind: body.kind,
      source: 'manual',
      emailEnc: body.email ? this.cipher.encrypt(body.email) : null,
      emailIndex: body.email ? this.cipher.blindIndex(body.email) : null,
      phoneEnc: body.phone ? this.cipher.encrypt(body.phone) : null,
      phoneIndex: body.phone ? this.cipher.blindIndex(body.phone) : null,
    });
    await audit.record(
      { action: 'whitelist.added', actorId, targetType: 'whitelist', targetId: String(rec._id) },
      meta,
    );
    return { id: String(rec._id) };
  }

  async remove(actorId: string, id: string, meta: RequestMetaLite) {
    const rec = await WhitelistModel.findById(id).select('status').lean();
    if (!rec) throw notFound('Record');
    if (rec.status === 'claimed')
      throw badRequest('This record is claimed by a verified member. Revoke their verification first.');
    await WhitelistModel.deleteOne({ _id: id, status: 'unclaimed' });
    await audit.record({ action: 'whitelist.removed', actorId, targetType: 'whitelist', targetId: id }, meta);
  }
}
