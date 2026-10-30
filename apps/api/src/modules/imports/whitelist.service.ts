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

/** +919848022338 → +91 ••••• ••338 (enough to recognise your own number, not to read it). */
export function maskPhone(phone: string): string {
  const tail = phone.slice(-3);
  const cc = phone.startsWith('+91') ? '+91' : phone.slice(0, 3);
  return `${cc} ••••• ••${tail}`;
}

export class WhitelistService {
  constructor(private readonly cipher: FieldCipher) {}

  // ── For placements (B7): the college's own list is where roll numbers and contacts live ──
  /** Roll number, branch and batch of each member who claimed a record. */
  async recordsOf(userIds: (string | Types.ObjectId)[]) {
    const rows = await WhitelistModel.find({
      claimedBy: { $in: userIds.map((u) => new Types.ObjectId(String(u))) },
    })
      .select('claimedBy rollNumber branch gradYear')
      .lean();
    return new Map(
      rows.map((r) => [
        String(r.claimedBy),
        { rollNumber: r.rollNumber, branch: r.branch ?? null, gradYear: r.gradYear ?? null },
      ]),
    );
  }

  /** Members (by user id) for roll numbers, among claimed records. */
  async membersByRoll(rolls: string[]): Promise<Map<string, string>> {
    const rows = await WhitelistModel.find({
      rollNumber: { $in: rolls.map((r) => r.trim().toUpperCase()) },
      status: 'claimed',
    })
      .select('rollNumber claimedBy')
      .lean();
    return new Map(rows.flatMap((r) => (r.claimedBy ? [[r.rollNumber, String(r.claimedBy)] as const] : [])));
  }

  /** Records on the college's list per branch and batch (B8 reports: the final-year count N). */
  async countsByCohort(gradYears: number[]) {
    const rows = await WhitelistModel.aggregate<{
      _id: { branch: string | null; gradYear: number };
      n: number;
    }>([
      { $match: { gradYear: { $in: gradYears } } },
      { $group: { _id: { branch: '$branch', gradYear: '$gradYear' }, n: { $sum: 1 } } },
    ]);
    return rows.map((r) => ({ branch: r._id.branch ?? null, gradYear: r._id.gradYear, n: r.n }));
  }

  /** The college's email and mobile for these members (a placement export the cell ticked). */
  async contactsOf(userIds: (string | Types.ObjectId)[]) {
    const rows = await WhitelistModel.find({
      claimedBy: { $in: userIds.map((u) => new Types.ObjectId(String(u))) },
    })
      .select('claimedBy emailEnc phoneEnc')
      .lean();
    return new Map(
      rows.map((r) => [
        String(r.claimedBy),
        {
          email: r.emailEnc ? this.cipher.decrypt(r.emailEnc) : null,
          phone: r.phoneEnc ? this.cipher.decrypt(r.phoneEnc) : null,
        },
      ]),
    );
  }

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
