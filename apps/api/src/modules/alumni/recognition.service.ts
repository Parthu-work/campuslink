import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  academicYearOf,
  academicYearRange,
  type AlumniOfMonthView,
  type CertificateEligibility,
  type CertificateView,
  type VerifiedCertificateView,
  type alumniOfMonthBody,
} from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { requireTenantId } from '../../lib/context.js';
import { plainText } from '../../lib/text.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { FilesService } from '../files/files.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import { findTenantById } from '../tenants/tenant.cache.js';
import {
  AlumniOfMonthModel,
  MentorCertificateModel,
  type AlumniOfMonthDoc,
  type MentorCertificateDoc,
} from './alumni.model.js';
import { renderCertificatePdf } from './alumni-pdf.js';

export const CERTIFICATE_RENDER_JOB = 'alumni.certificate';
const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;

export interface RecognitionDeps {
  profiles: ProfilesService;
  files: FilesService;
  jobs: JobQueue;
  notifications: NotificationsService;
  /** Completed sessions the member mentored in a window, and how many different mentees. */
  mentored: (userId: string, from: Date, to: Date) => Promise<{ sessions: number; mentees: number }>;
  /** Micro-asks the member did in a window. */
  asksDone: (userId: string, from: Date, to: Date) => Promise<number>;
  /** Events the member hosted that ended in a window. */
  hosted: (userId: string, from: Date, to: Date) => Promise<number>;
  /** A link on the college's own site (auth.tenantUrl). */
  urlFor: (path: string) => Promise<string>;
  /** Posts an official announcement as the placement cell member (feed). */
  announce: (actor: AuthState, body: string) => Promise<string>;
}

/**
 * Recognition (prompt 2, G6): a mentorship certificate per academic year, signed by the college's
 * name and checked at a public link by its random verification code (owner decision: no signing
 * key; G12's verifiable credentials can replace it), and an "alumnus of the month" the placement
 * cell nominates, the alumnus accepts, and the Wall of Mentors shows.
 */
export class RecognitionService {
  track: Track = noTrack;
  constructor(private readonly d: RecognitionDeps) {}

  // ── Certificates ─────────────────────────────

  private view(c: MentorCertificateDoc): CertificateView {
    return {
      id: String(c._id),
      academicYear: c.academicYear,
      status: c.status,
      sessions: c.sessions,
      mentees: c.mentees,
      asks: c.asks,
      events: c.events,
      code: c.code,
      issuedAt: c.createdAt.toISOString(),
    };
  }

  private async counts(userId: string, academicYear: string) {
    const { from, to } = academicYearRange(academicYear);
    const [m, asks, events] = await Promise.all([
      this.d.mentored(userId, from, to),
      this.d.asksDone(userId, from, to),
      this.d.hosted(userId, from, to),
    ]);
    return { sessions: m.sessions, mentees: m.mentees, asks, events };
  }

  /** This academic year and the last: what a certificate would say, and whether one exists. */
  async eligibility(viewer: AuthState, now = new Date()): Promise<CertificateEligibility[]> {
    const current = academicYearOf(now);
    const last = academicYearOf(new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1)));
    const existing = new Map(
      (
        await MentorCertificateModel.find({
          userId: oid(viewer.userId),
          academicYear: { $in: [current, last] },
        })
          .select('academicYear')
          .lean<MentorCertificateDoc[]>()
      ).map((c) => [c.academicYear, String(c._id)]),
    );
    return Promise.all(
      [current, last].map(async (ay) => {
        const c = await this.counts(viewer.userId, ay);
        return {
          academicYear: ay,
          ...c,
          eligible: c.sessions + c.asks + c.events > 0,
          certificateId: existing.get(ay) ?? null,
        };
      }),
    );
  }

  async certificates(viewer: AuthState): Promise<CertificateView[]> {
    const rows = await MentorCertificateModel.find({ userId: oid(viewer.userId) })
      .sort({ academicYear: -1 })
      .lean<MentorCertificateDoc[]>();
    return rows.map((c) => this.view(c));
  }

  /**
   * Issues (or, for the year still running, refreshes) the member's certificate for an academic
   * year with something to certify. The code stays the same across refreshes; a revoked one stays
   * revoked.
   */
  async issue(viewer: AuthState, academicYear: string, now = new Date()): Promise<CertificateView> {
    if (academicYear > academicYearOf(now)) throw badRequest('That academic year has not started');
    const c = await this.counts(viewer.userId, academicYear);
    if (c.sessions + c.asks + c.events === 0)
      throw badRequest(
        'There is nothing to certify for that year yet: a session, an ask or an event you hosted',
      );
    const name = (await this.d.profiles.refsFor([viewer.userId])).get(viewer.userId)?.name ?? viewer.userId;
    const u = oid(viewer.userId);
    const existing = await MentorCertificateModel.findOne({
      userId: u,
      academicYear,
    }).lean<MentorCertificateDoc>();
    if (existing?.status === 'revoked') throw conflict('This certificate was revoked by your college');
    let cert: MentorCertificateDoc | null;
    if (existing)
      cert = await MentorCertificateModel.findOneAndUpdate(
        { _id: existing._id, status: { $ne: 'revoked' } },
        { $set: { ...c, name, status: 'rendering' } },
        { returnDocument: 'after' },
      ).lean<MentorCertificateDoc>();
    else
      try {
        cert = (
          await MentorCertificateModel.create({
            userId: u,
            academicYear,
            name,
            ...c,
            code: randomBytes(16).toString('hex'),
          })
        ).toObject() as MentorCertificateDoc;
        await this.track(viewer.userId, 'certificate_issued', {
          academicYear: academicYear.replace('-', '_'),
        });
      } catch (e) {
        if (!isDuplicate(e)) throw e;
        cert = await MentorCertificateModel.findOne({ userId: u, academicYear }).lean<MentorCertificateDoc>();
      }
    if (!cert) throw conflict('This certificate just changed. Try again.');
    await this.d.jobs.enqueue(
      CERTIFICATE_RENDER_JOB,
      { tenantId: String(requireTenantId()), certificateId: String(cert._id) },
      { jobId: `cert-${String(cert._id)}-${Date.now()}` },
    );
    return this.view(cert);
  }

  /** Job (worker): draws the PDF, stores it with the certificate and tells the member. */
  async onRender(job: TenantJob) {
    const c = await MentorCertificateModel.findById(String(job.certificateId)).lean<MentorCertificateDoc>();
    if (!c || c.status === 'revoked') return;
    const tenant = await findTenantById(requireTenantId());
    const pdf = await renderCertificatePdf({
      college: tenant?.branding.displayName ?? '',
      name: c.name,
      academicYear: c.academicYear,
      sessions: c.sessions,
      mentees: c.mentees,
      asks: c.asks,
      events: c.events,
      code: c.code,
      verifyUrl: await this.d.urlFor(`/verify-certificate/${c.code}`),
      issuedOn: new Date().toISOString().slice(0, 10),
    });
    const file = await this.d.files.storeAlumniPdf(String(c.userId), 'mentor_certificate', pdf);
    const res = await MentorCertificateModel.updateOne(
      { _id: c._id, status: { $ne: 'revoked' } },
      { $set: { pdfFileId: new Types.ObjectId(file.id), status: 'issued' } },
    );
    if (!res.modifiedCount) return void (await this.d.files.remove(file.id));
    if (c.pdfFileId) await this.d.files.remove(c.pdfFileId);
    await this.d.notifications.notify(c.userId, 'certificate_ready', { academicYear: c.academicYear });
  }

  async pdf(viewer: AuthState, id: string): Promise<{ data: Buffer; name: string }> {
    const c = await MentorCertificateModel.findOne({
      _id: id,
      userId: oid(viewer.userId),
    }).lean<MentorCertificateDoc>();
    if (!c || !c.pdfFileId) throw notFound('Certificate');
    return { data: await this.d.files.read(String(c.pdfFileId)), name: `mentorship-${c.academicYear}.pdf` };
  }

  /** The public check (no sign-in): what the certificate says, and whether it still stands. */
  async verify(code: string): Promise<VerifiedCertificateView> {
    const c = await MentorCertificateModel.findOne({
      code,
      status: { $in: ['issued', 'revoked'] },
    }).lean<MentorCertificateDoc>();
    if (!c) throw notFound('Certificate');
    const tenant = await findTenantById(requireTenantId());
    return {
      valid: c.status === 'issued',
      status: c.status,
      name: c.name,
      college: tenant?.branding.displayName ?? '',
      academicYear: c.academicYear,
      sessions: c.sessions,
      mentees: c.mentees,
      asks: c.asks,
      events: c.events,
      issuedAt: c.createdAt.toISOString(),
    };
  }

  async adminCertificates(): Promise<(CertificateView & { person: { userId: string; name: string } })[]> {
    const rows = await MentorCertificateModel.find({})
      .sort({ createdAt: -1 })
      .limit(200)
      .lean<MentorCertificateDoc[]>();
    return rows.map((c) => ({ ...this.view(c), person: { userId: String(c.userId), name: c.name } }));
  }

  async revoke(actor: AuthState, id: string, meta: RequestMetaLite): Promise<CertificateView> {
    const c = await MentorCertificateModel.findOneAndUpdate(
      { _id: id, status: { $ne: 'revoked' } },
      { $set: { status: 'revoked', revokedAt: new Date() } },
      { returnDocument: 'after' },
    ).lean<MentorCertificateDoc>();
    if (!c) throw notFound('Certificate');
    await audit.record(
      {
        action: 'alumni.certificate_revoked',
        actorId: actor.userId,
        targetType: 'certificate',
        targetId: id,
      },
      meta,
    );
    return this.view(c);
  }

  // ── Alumnus of the month ─────────────────────────────

  private async ofMonthViews(rows: AlumniOfMonthDoc[]): Promise<AlumniOfMonthView[]> {
    const refs = await this.d.profiles.refsFor(rows.map((r) => r.userId));
    return rows.flatMap((r) => {
      const person = refs.get(String(r.userId));
      return person
        ? [
            {
              id: String(r._id),
              person,
              month: r.month,
              citation: r.citation,
              status: r.status,
              announced: !!r.postId,
              createdAt: r.createdAt.toISOString(),
            },
          ]
        : [];
    });
  }

  /** The placement cell nominates; the alumnus is asked first (nothing is shown until they accept). */
  async nominate(actor: AuthState, body: z.output<typeof alumniOfMonthBody>, meta: RequestMetaLite) {
    const roles = (await this.d.profiles.rolesOf([body.userId])).get(body.userId) ?? [];
    if (!roles.includes('ALUMNI') || !(await this.d.profiles.isActiveMember(body.userId)))
      throw badRequest('Nominate a verified alumnus');
    let doc: AlumniOfMonthDoc;
    try {
      doc = (
        await AlumniOfMonthModel.create({
          userId: oid(body.userId),
          month: body.month,
          citation: plainText(body.citation),
          nominatedBy: oid(actor.userId),
        })
      ).toObject() as AlumniOfMonthDoc;
    } catch (e) {
      if (isDuplicate(e)) throw conflict('Someone is already nominated for that month');
      throw e;
    }
    await this.d.notifications.notify(body.userId, 'alumni_of_month_nominated', {
      month: body.month,
      nominationId: String(doc._id),
    });
    await audit.record(
      {
        action: 'alumni.of_month_nominated',
        actorId: actor.userId,
        targetType: 'user',
        targetId: body.userId,
        meta: { month: body.month },
      },
      meta,
    );
    return (await this.ofMonthViews([doc]))[0] as AlumniOfMonthView;
  }

  /** The nominee accepts (it is published) or declines (the month is free again). */
  async replyOfMonth(viewer: AuthState, id: string, accept: boolean): Promise<AlumniOfMonthView> {
    const doc = await AlumniOfMonthModel.findOneAndUpdate(
      { _id: id, userId: oid(viewer.userId), status: 'proposed' },
      { $set: { status: accept ? 'published' : 'declined' } },
      { returnDocument: 'after' },
    ).lean<AlumniOfMonthDoc>();
    if (!doc) throw notFound('Nomination');
    return (await this.ofMonthViews([doc]))[0] as AlumniOfMonthView;
  }

  async myNominations(viewer: AuthState): Promise<AlumniOfMonthView[]> {
    return this.ofMonthViews(
      await AlumniOfMonthModel.find({ userId: oid(viewer.userId) })
        .sort({ month: -1 })
        .limit(24)
        .lean<AlumniOfMonthDoc[]>(),
    );
  }

  /** The Wall of Mentors: published alumni of the month, the last twelve. */
  async ofMonth(): Promise<AlumniOfMonthView[]> {
    return this.ofMonthViews(
      await AlumniOfMonthModel.find({ status: 'published' })
        .sort({ month: -1 })
        .limit(12)
        .lean<AlumniOfMonthDoc[]>(),
    );
  }

  async adminOfMonth(): Promise<AlumniOfMonthView[]> {
    return this.ofMonthViews(
      await AlumniOfMonthModel.find({})
        .sort({ month: -1, createdAt: -1 })
        .limit(60)
        .lean<AlumniOfMonthDoc[]>(),
    );
  }

  /** Posts the announcement (the college's text, from the template) once the alumnus accepted. */
  async announce(
    actor: AuthState,
    id: string,
    body: string,
    meta: RequestMetaLite,
  ): Promise<AlumniOfMonthView> {
    if (!actor.permissions.has('announcements:post')) throw forbidden();
    const doc = await AlumniOfMonthModel.findById(id).lean<AlumniOfMonthDoc>();
    if (!doc) throw notFound('Nomination');
    if (doc.status !== 'published') throw conflict('Announce once the alumnus has accepted');
    if (doc.postId) throw conflict('Already announced');
    const postId = await this.d.announce(actor, body);
    const res = await AlumniOfMonthModel.updateOne(
      { _id: doc._id, postId: null },
      { $set: { postId: oid(postId) } },
    );
    if (!res.modifiedCount) throw conflict('Already announced');
    await audit.record(
      { action: 'alumni.of_month_announced', actorId: actor.userId, targetType: 'post', targetId: postId },
      meta,
    );
    return (await this.ofMonthViews([{ ...doc, postId: oid(postId) }]))[0] as AlumniOfMonthView;
  }

  // ── Privacy ─────────────────────────────

  async exportFor(userId: string) {
    const u = oid(userId);
    const [certificates, alumniOfMonth] = await Promise.all([
      MentorCertificateModel.find({ userId: u })
        .select('academicYear sessions mentees asks events code status createdAt')
        .lean(),
      AlumniOfMonthModel.find({ userId: u }).select('month citation status createdAt').lean(),
    ]);
    return { certificates, alumniOfMonth };
  }

  /** Certificates (their PDFs go with the member's files) and nominations go; their links stop working. */
  async eraseFor(userId: string) {
    const u = oid(userId);
    await MentorCertificateModel.deleteMany({ userId: u });
    await AlumniOfMonthModel.deleteMany({ userId: u });
    await AlumniOfMonthModel.updateMany({ nominatedBy: u }, { $set: { nominatedBy: null } });
  }
}
