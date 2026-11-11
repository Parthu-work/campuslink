import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  ErrorCode,
  RESERVED_SLUGS,
  istDay,
  type CollegeOutcomesView,
  type GrowthSettingsView,
  type MyPublicPagesView,
  type PublicNameStyle,
  type PublicPageContent,
  type PublicPageKind,
  type PublicPageOption,
  type PublicPageView,
  type publicPageBody,
} from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { requireTenantId } from '../../lib/context.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { findTenantById } from '../tenants/tenant.cache.js';
import type { TenantRecord } from '../tenants/tenant.cache.js';
import {
  GrowthSettingsModel,
  PublicPageModel,
  type GrowthSettingsDoc,
  type PublicPageDoc,
} from './public-page.model.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));

/** What each source module answers (modules talk through services). */
export interface PublicPagesDeps {
  /** The member's name, batch and whether they are a minor (minors never get a public page, E4). */
  person: (userId: string) => Promise<{ name: string; gradYear: number | null; minor: boolean } | null>;
  /** The member's verified offers: company and role only (never the CTC). */
  verifiedOffers: (
    userId: string,
  ) => Promise<{ id: string; company: string; role: string; gradYear: number | null }[]>;
  /** Roadmaps the member finished. */
  finishedRoadmaps: (userId: string) => Promise<{ id: string; title: string; steps: number }[]>;
  /** Students the member mentored (completed sessions, distinct mentees). */
  mentees: (userId: string) => Promise<number>;
  /** The member's mentor card, when they mentor: title, company and topics they show to members. */
  mentorCard: (userId: string) => Promise<{ jobTitle: string; company: string; topics: string[] } | null>;
  /** The college outcomes page's aggregates. */
  outcomes: () => Promise<Omit<CollegeOutcomesView, 'college' | 'updatedAt'>>;
  tenantUrl: (tenant: TenantRecord, path: string) => string;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
const slugBase = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/**
 * Opt-in public pages and the college outcomes page (prompt 2, G8, E4). A member publishes one
 * achievement per page; the page and its share image show only what that page is about, the name
 * as they chose (full or first name), the college and the year. Minors cannot publish. Pages are
 * computed when served, so a revoked offer, an unpublished roadmap or a page taken down is a 404.
 */
export class PublicPagesService {
  track: Track = noTrack;

  constructor(private readonly d: PublicPagesDeps) {}

  private async tenant(): Promise<TenantRecord> {
    const t = await findTenantById(requireTenantId());
    if (!t) throw notFound('College');
    return t;
  }

  private async options(userId: string): Promise<PublicPageOption[]> {
    const [offers, roadmaps, mentees, mentor, live] = await Promise.all([
      this.d.verifiedOffers(userId),
      this.d.finishedRoadmaps(userId),
      this.d.mentees(userId),
      this.d.mentorCard(userId),
      PublicPageModel.find({ userId: oid(userId), status: 'live' }).lean<PublicPageDoc[]>(),
    ]);
    const pageOf = (kind: PublicPageKind, refId: string | null) =>
      live.find((p) => p.kind === kind && String(p.refId ?? '') === (refId ?? ''))?._id ?? null;
    const opts: PublicPageOption[] = [
      ...offers.map((o) => ({ kind: 'placed' as const, refId: o.id, headline: `Placed at ${o.company}` })),
      ...roadmaps.map((r) => ({
        kind: 'roadmap' as const,
        refId: r.id,
        headline: `Finished the ${r.title} roadmap`,
      })),
      ...(mentees > 0
        ? [
            {
              kind: 'mentored' as const,
              refId: null,
              headline: `Mentored ${mentees} ${mentees === 1 ? 'student' : 'students'}`,
            },
          ]
        : []),
      ...(mentor ? [{ kind: 'mentor' as const, refId: null, headline: 'Mentor profile' }] : []),
    ].map((o) => ({
      ...o,
      pageId: (() => {
        const id = pageOf(o.kind, o.refId);
        return id ? String(id) : null;
      })(),
    }));
    return opts;
  }

  /** What a page says now, or null when its source is gone (or its owner became unable to publish). */
  async content(
    p: Pick<PublicPageDoc, 'userId' | 'kind' | 'refId' | 'nameStyle'>,
    college: string,
  ): Promise<PublicPageContent | null> {
    const userId = String(p.userId);
    const person = await this.d.person(userId);
    if (!person || person.minor) return null;
    const name = p.nameStyle === 'first' ? firstName(person.name) : person.name.trim();
    const base = { kind: p.kind, name, college, year: person.gradYear };
    if (p.kind === 'placed') {
      const o = (await this.d.verifiedOffers(userId)).find((x) => x.id === String(p.refId));
      return o
        ? { ...base, headline: `Placed at ${o.company}`, detail: o.role, year: o.gradYear ?? person.gradYear }
        : null;
    }
    if (p.kind === 'roadmap') {
      const r = (await this.d.finishedRoadmaps(userId)).find((x) => x.id === String(p.refId));
      return r
        ? { ...base, headline: `Finished the ${r.title} roadmap`, detail: `All ${r.steps} steps done` }
        : null;
    }
    if (p.kind === 'mentored') {
      const n = await this.d.mentees(userId);
      return n > 0
        ? {
            ...base,
            headline: `Mentored ${n} ${n === 1 ? 'student' : 'students'}`,
            // Peer mentors are students, so not "alumni".
            detail: `Mentor at ${college}`,
          }
        : null;
    }
    const m = await this.d.mentorCard(userId);
    return m
      ? {
          ...base,
          headline: 'Mentor',
          detail: [[m.jobTitle, m.company].filter(Boolean).join(' at '), m.topics.slice(0, 4).join(', ')]
            .filter(Boolean)
            .join(' · '),
        }
      : null;
  }

  private async view(p: PublicPageDoc, tenant: TenantRecord): Promise<PublicPageView> {
    return {
      id: String(p._id),
      kind: p.kind,
      slug: p.slug,
      url: this.d.tenantUrl(tenant, `/p/${p.slug}`),
      nameStyle: p.nameStyle,
      indexable: p.indexable,
      status: p.status,
      views: p.views,
      content: p.status === 'live' ? await this.content(p, tenant.branding.displayName) : null,
      createdAt: p.createdAt.toISOString(),
    };
  }

  async mine(viewer: AuthState): Promise<MyPublicPagesView> {
    const tenant = await this.tenant();
    const pages = await PublicPageModel.find({ userId: oid(viewer.userId) })
      .sort({ _id: -1 })
      .limit(50)
      .lean<PublicPageDoc[]>();
    return {
      pages: await Promise.all(pages.map((p) => this.view(p, tenant))),
      options: viewer.minor ? [] : await this.options(viewer.userId),
      allowed: !viewer.minor,
    };
  }

  /** Publishes one page (a member's own choice, E4); the same achievement twice returns the live page. */
  async publish(viewer: AuthState, body: z.output<typeof publicPageBody>): Promise<PublicPageView> {
    if (viewer.minor) throw new AppError(403, ErrorCode.FORBIDDEN, 'Public pages are for members over 18');
    const option = (await this.options(viewer.userId)).find(
      (o) => o.kind === body.kind && (o.refId ?? null) === (body.refId ?? null),
    );
    if (!option) throw badRequest('There is nothing to show for that yet');
    const tenant = await this.tenant();
    if (option.pageId) {
      const existing = await PublicPageModel.findById(option.pageId).lean<PublicPageDoc>();
      if (existing) return this.view(existing, tenant);
    }
    const person = await this.d.person(viewer.userId);
    const base = slugBase(`${firstName(person?.name ?? '')}-${body.kind}`) || body.kind;
    let doc: PublicPageDoc | null = null;
    for (let i = 0; i < 5 && !doc; i++) {
      const slug = `${base}-${randomBytes(3).toString('hex')}`;
      if ((RESERVED_SLUGS as readonly string[]).includes(slug)) continue;
      try {
        doc = (
          await PublicPageModel.create({
            userId: oid(viewer.userId),
            kind: body.kind,
            refId: body.refId ? oid(body.refId) : null,
            slug,
            nameStyle: body.nameStyle,
            indexable: body.indexable,
          })
        ).toObject() as PublicPageDoc;
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        const live = await PublicPageModel.findOne({
          userId: oid(viewer.userId),
          kind: body.kind,
          refId: body.refId ? oid(body.refId) : null,
          status: 'live',
        }).lean<PublicPageDoc>();
        if (live) return this.view(live, tenant);
      }
    }
    if (!doc) throw conflict('Could not publish the page. Try again.');
    await this.track(viewer.userId, 'public_page_published', { kind: body.kind });
    return this.view(doc, tenant);
  }

  /** Takes a page down: its link stops working at once (and the share image with it). */
  async revoke(viewer: AuthState, id: string): Promise<PublicPageView> {
    const doc = await PublicPageModel.findOneAndUpdate(
      { _id: oid(id), userId: oid(viewer.userId) },
      { $set: { status: 'revoked', revokedAt: new Date() } },
      { returnDocument: 'after' },
    ).lean<PublicPageDoc>();
    if (!doc) throw notFound('Page');
    return this.view(doc, await this.tenant());
  }

  /** A live page by its slug, for the public routes (null: 404). Counts the view. */
  async served(
    slug: string,
    countView: boolean,
  ): Promise<{ page: PublicPageDoc; content: PublicPageContent; tenant: TenantRecord } | null> {
    if ((RESERVED_SLUGS as readonly string[]).includes(slug)) return null;
    const page = await PublicPageModel.findOne({ slug, status: 'live' }).lean<PublicPageDoc>();
    if (!page) return null;
    const tenant = await this.tenant();
    const content = await this.content(page, tenant.branding.displayName);
    if (!content) return null;
    if (countView) {
      const today = istDay(new Date());
      const first = await PublicPageModel.findOneAndUpdate(
        { _id: page._id, lastViewDay: { $ne: today } },
        { $inc: { views: 1 }, $set: { lastViewDay: today } },
      ).lean();
      if (!first) await PublicPageModel.updateOne({ _id: page._id }, { $inc: { views: 1 } });
      // Aggregate only: one event per page a day, about the page's owner, never about the viewer.
      else await this.track(String(page.userId), 'public_page_viewed', { kind: page.kind });
    }
    return { page, content, tenant };
  }

  urls(tenant: TenantRecord, slug: string) {
    return {
      url: this.d.tenantUrl(tenant, `/p/${slug}`),
      image: this.d.tenantUrl(tenant, `/p/${slug}/og.png`),
      joinUrl: this.d.tenantUrl(tenant, '/'),
    };
  }

  // ── The college outcomes page ─────────────────────────────

  private async settingsDoc(): Promise<GrowthSettingsDoc | null> {
    return GrowthSettingsModel.findOne({ key: 'growth' }).lean<GrowthSettingsDoc>();
  }

  async settings(): Promise<GrowthSettingsView> {
    const [s, tenant] = await Promise.all([this.settingsDoc(), this.tenant()]);
    return {
      memberInvites: {
        enabled: !!s?.memberInvites.enabled,
        attestedAt: s?.memberInvites.attestedAt?.toISOString() ?? null,
      },
      outcomesPage: {
        enabled: !!s?.outcomesPage.enabled,
        url: s?.outcomesPage.enabled ? this.d.tenantUrl(tenant, '/p/outcomes') : null,
      },
    };
  }

  /** The pilot preset (prompt 4, P11) reads and switches off the public outcomes page. */
  async outcomesPageEnabled(): Promise<boolean> {
    return !!(await this.settingsDoc())?.outcomesPage.enabled;
  }
  async switchOutcomesPageOff(): Promise<void> {
    await GrowthSettingsModel.updateOne(
      { key: 'growth', 'outcomesPage.enabled': true },
      { $set: { 'outcomesPage.enabled': false, 'outcomesPage.at': new Date() } },
    );
  }

  async memberInvitesEnabled(): Promise<boolean> {
    return !!(await this.settingsDoc())?.memberInvites.enabled;
  }

  /** The college turns member invites on: it confirms everyone on its list agreed to hear from it on WhatsApp. */
  async setMemberInvites(actor: AuthState, enabled: boolean, attestOptIn: boolean, meta: RequestMetaLite) {
    if (enabled && !attestOptIn)
      throw badRequest('Confirm that the people on your list agreed to hear from the college on WhatsApp');
    await GrowthSettingsModel.updateOne(
      { key: 'growth' },
      {
        $set: {
          'memberInvites.enabled': enabled,
          ...(enabled
            ? { 'memberInvites.attestedBy': oid(actor.userId), 'memberInvites.attestedAt': new Date() }
            : {}),
        },
      },
      { upsert: true },
    );
    await audit.record(
      { action: 'growth.member_invites', actorId: actor.userId, meta: { enabled, attestOptIn } },
      meta,
    );
    return this.settings();
  }

  async setOutcomesPage(actor: AuthState, enabled: boolean, meta: RequestMetaLite) {
    await GrowthSettingsModel.updateOne(
      { key: 'growth' },
      {
        $set: {
          'outcomesPage.enabled': enabled,
          'outcomesPage.by': oid(actor.userId),
          'outcomesPage.at': new Date(),
        },
      },
      { upsert: true },
    );
    await audit.record({ action: 'growth.outcomes_page', actorId: actor.userId, meta: { enabled } }, meta);
    return this.settings();
  }

  /** The outcomes page's figures (null while the college has it off: the public route is then a 404). */
  async outcomes(force = false): Promise<{ view: CollegeOutcomesView; tenant: TenantRecord } | null> {
    if (!force && !(await this.settingsDoc())?.outcomesPage.enabled) return null;
    const tenant = await this.tenant();
    const figures = await this.d.outcomes();
    return {
      view: { ...figures, college: tenant.branding.displayName, updatedAt: new Date().toISOString() },
      tenant,
    };
  }

  // ── Privacy ─────────────────────────────

  async exportFor(userId: string) {
    const pages = await PublicPageModel.find({ userId: oid(userId) })
      .select('kind slug nameStyle indexable status views createdAt revokedAt')
      .lean();
    return { publicPages: pages.map(({ _id, ...p }) => p) };
  }

  /** Erasure: every page goes, so every link and share image is a 404 at once. */
  async eraseFor(userId: string) {
    await PublicPageModel.deleteMany({ userId: oid(userId) });
  }

  nameOf(style: PublicNameStyle, name: string) {
    return style === 'first' ? firstName(name) : name;
  }
}
