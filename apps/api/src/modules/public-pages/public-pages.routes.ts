import {
  memberInviteSettingsBody,
  outcomesPageBody,
  publicPageBody,
  publicPageIdParams,
  publicSlugParams,
} from '@campuslink/shared';
import type { AnyRouteSpec, HandlerResult } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import { notFoundHtml, outcomesHtml, pageHtml, sharePng, shareSvg } from './render.js';
import type { PublicPagesService } from './public-pages.service.js';

const tag = 'Public pages';
const share = { kind: 'permission', permission: 'share:pages' } as const;
const onboarding = { kind: 'permission', permission: 'onboarding:manage' } as const;
const settings = { kind: 'permission', permission: 'tenant:settings' } as const;
const PUBLIC = { kind: 'public' } as const;

/**
 * A member's page is never cached (E4: taking it down works at once, also in a browser that saw it);
 * the college's outcomes page, aggregates only, may be cached for five minutes.
 */
const MEMBER = 'no-store';
const COLLEGE = 'public, max-age=300';
const html = (body: string, status = 200, cache = MEMBER): HandlerResult => ({
  status,
  data: null,
  raw: {
    body,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': status === 200 ? cache : 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  },
});
const png = (body: Buffer, cache = MEMBER): HandlerResult => ({
  data: null,
  raw: {
    body,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' },
  },
});

/** Members' pages and the college's growth settings (prompt 2, G8), under the API prefix. */
export function publicPageRoutes(s: PublicPagesService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/me/public-pages',
      tag,
      summary: 'My public pages and what I could publish (a placement, a roadmap, mentoring)',
      access: share,
      handler: async ({ req }) => ({ data: await s.mine(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/me/public-pages',
      tag,
      summary: 'Publish one achievement as a public page (opt-in, revocable)',
      access: share,
      limiter: 'posting',
      body: publicPageBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.publish(authOf(req), body) }),
    },
    {
      method: 'delete',
      path: '/me/public-pages/:id',
      tag,
      summary: 'Take a public page down (its link stops working)',
      access: share,
      params: publicPageIdParams,
      handler: async ({ req, params }) => ({ data: await s.revoke(authOf(req), params.id) }),
    },
    {
      method: 'get',
      path: '/admin/growth',
      tag,
      summary: 'Member invites and the public outcomes page: on or off',
      access: onboarding,
      handler: async () => ({ data: await s.settings() }),
    },
    {
      method: 'put',
      path: '/admin/growth/member-invites',
      tag,
      summary: 'Let members invite their batch on WhatsApp (the college confirms its list opted in)',
      access: onboarding,
      body: memberInviteSettingsBody,
      handler: async ({ req, body }) => ({
        data: await s.setMemberInvites(authOf(req), body.enabled, body.attestOptIn, requestMeta(req)),
      }),
    },
    {
      method: 'put',
      path: '/admin/growth/outcomes-page',
      tag,
      summary: 'Publish (or take down) the college outcomes page',
      access: settings,
      body: outcomesPageBody,
      handler: async ({ req, body }) => ({
        data: await s.setOutcomesPage(authOf(req), body.enabled, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/growth/outcomes-preview',
      tag,
      summary: 'What the outcomes page shows (also while it is off)',
      access: settings,
      handler: async () => ({ data: (await s.outcomes(true))?.view ?? null }),
    },
  ];
}

/**
 * The public pages themselves, served at /p/... on the college's own address (outside the API
 * prefix, so links read https://<college>/p/<slug>): HTML with Open Graph tags and a share image.
 * Anything not published, or taken down, is a plain 404.
 */
export function shareRoutes(s: PublicPagesService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/p/outcomes',
      tag,
      summary: 'The college outcomes page (only while the college publishes it)',
      access: PUBLIC,
      limiter: 'search',
      handler: async () => {
        const o = await s.outcomes();
        if (!o) return html(notFoundHtml(), 404);
        return html(outcomesHtml(o.view, s.urls(o.tenant, 'outcomes')), 200, COLLEGE);
      },
    },
    {
      method: 'get',
      path: '/p/outcomes/og.png',
      tag,
      summary: 'The outcomes page share image',
      access: PUBLIC,
      limiter: 'search',
      handler: async () => {
        const o = await s.outcomes();
        if (!o) return html(notFoundHtml(), 404);
        const latest = o.view.years.find((y) => y.placementPct !== null);
        return png(
          await sharePng(
            shareSvg({
              college: o.view.college,
              headline: latest
                ? `${latest.placementPct}% placed in ${latest.gradYear}`
                : 'Placement outcomes',
              detail: o.view.recruiters
                .slice(0, 3)
                .map((r) => r.company)
                .join(', '),
              name: 'Placement outcomes',
            }),
          ),
          COLLEGE,
        );
      },
    },
    {
      method: 'get',
      path: '/p/:slug',
      tag,
      summary: 'A member\x27s public page (only while they publish it)',
      access: PUBLIC,
      limiter: 'search',
      params: publicSlugParams,
      handler: async ({ params }) => {
        const p = await s.served(params.slug, true);
        if (!p) return html(notFoundHtml(), 404);
        return html(pageHtml(p.content, { ...s.urls(p.tenant, p.page.slug), indexable: p.page.indexable }));
      },
    },
    {
      method: 'get',
      path: '/p/:slug/og.png',
      tag,
      summary: 'A public page\x27s share image (its opt-in fields only)',
      access: PUBLIC,
      limiter: 'search',
      params: publicSlugParams,
      handler: async ({ params }) => {
        const p = await s.served(params.slug, false);
        if (!p) return html(notFoundHtml(), 404);
        return png(await sharePng(shareSvg(p.content)));
      },
    },
  ];
}
