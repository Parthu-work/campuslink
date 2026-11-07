import { z } from 'zod';
import {
  NETWORK_CONSENT_KEYS,
  candidacyBody,
  introAcceptBody,
  introBody,
  introDeclineBody,
  networkRefParams,
  networkSearchQuery,
  networkSettingsBody,
  networkSwitchBody,
  objectId,
  postingDecisionBody,
  blockEmployerBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { NetworkService } from './network.service.js';
import type { CollegePostingsService } from '../employers/college-postings.service.js';

const tag = 'Network';
const member = { kind: 'permission', permission: 'network:discover' } as const;
const manage = { kind: 'permission', permission: 'network:manage' } as const;
const settings = { kind: 'permission', permission: 'tenant:settings' } as const;
const idParams = z.strictObject({ id: objectId });
const userParams = z.strictObject({ userId: objectId });
const consentBody = z.strictObject({ purpose: z.enum(NETWORK_CONSENT_KEYS), granted: z.boolean() });
const moderateBody = z.strictObject({ keep: z.boolean() });

/** The network on a college's host (prompt 2, G12, ADR 0014): members, then the college. */
export function networkRoutes(s: NetworkService, postings: CollegePostingsService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/network/me',
      tag,
      summary: 'My network settings, consents and who opened what I shared',
      access: member,
      handler: async ({ req }) => ({ data: await s.settings(authOf(req)) }),
    },
    {
      method: 'put',
      path: '/network/me',
      tag,
      summary: 'What other colleges and employers may see of me (the projection follows at once)',
      access: member,
      body: networkSettingsBody,
      readOnlyOk: true,
      handler: async ({ req, body }) => ({ data: await s.saveSettings(authOf(req), body) }),
    },
    {
      method: 'put',
      path: '/network/consents',
      tag,
      summary: 'Grant or withdraw network_discovery or employer_visibility (never for minors)',
      access: member,
      body: consentBody,
      readOnlyOk: true,
      handler: async ({ req, body }) => ({
        data: await s.setConsent(authOf(req), body.purpose, body.granted, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/network/alumni',
      tag,
      summary: 'Alumni of other opted-in colleges (P1; the projection only)',
      access: member,
      limiter: 'network',
      query: networkSearchQuery,
      handler: async ({ req, query }) => ({ data: await s.search(authOf(req), query, requestMeta(req)) }),
    },
    {
      method: 'get',
      path: '/network/alumni/:ref',
      tag,
      summary: 'One alumnus of another college (P2)',
      access: member,
      limiter: 'network',
      params: networkRefParams,
      handler: async ({ req, params }) => ({
        data: await s.cardOf(authOf(req), params.ref, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/network/intros',
      tag,
      summary: 'Intros I sent and received',
      access: member,
      handler: async ({ req }) => ({ data: await s.intros(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/network/intros',
      tag,
      summary: 'Ask an alumnus of another college for help (P3; weekly caps)',
      access: member,
      limiter: 'requests',
      idempotent: true,
      body: introBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.sendIntro(authOf(req), body, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/network/intros/:id/accept',
      tag,
      summary: 'Accept an intro and share a contact with that one student (P4)',
      access: member,
      params: idParams,
      body: introAcceptBody,
      handler: async ({ req, params, body }) => ({
        data: await s.accept(authOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/network/intros/:id/decline',
      tag,
      summary: 'Decline an intro (P4)',
      access: member,
      params: idParams,
      body: introDeclineBody,
      handler: async ({ req, params, body }) => ({
        data: await s.decline(authOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/network/intros/:id/report',
      tag,
      summary: 'Report an intro to the sender’s college (P6)',
      access: member,
      limiter: 'reports',
      readOnlyOk: true,
      params: idParams,
      handler: async ({ req, params }) => ({
        data: await s.report(authOf(req), params.id, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/network/candidacies',
      tag,
      summary: 'Employer drives I registered for, and what I shared with each employer',
      access: member,
      handler: async ({ req }) => ({ data: await postings.mine(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/network/candidacies',
      tag,
      summary: 'Share my résumé and readiness with the employer of a drive I registered for',
      access: member,
      idempotent: true,
      body: candidacyBody,
      handler: async ({ req, body }) => ({
        data: await postings.share(authOf(req), body.driveId, requestMeta(req)),
      }),
    },
    {
      method: 'delete',
      path: '/network/candidacies/:ref',
      tag,
      summary: 'Stop sharing with an employer (at once)',
      access: member,
      readOnlyOk: true,
      params: networkRefParams,
      handler: async ({ req, params }) => ({
        data: await postings.withdraw(authOf(req), params.ref, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/network/postings/:id/report',
      tag,
      summary: 'Report an employer posting (three reports hide it until a moderator decides)',
      access: member,
      limiter: 'reports',
      readOnlyOk: true,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await postings.report(authOf(req), params.id) }),
    },
    // ── The college ─────────────────────────────
    {
      method: 'get',
      path: '/admin/network',
      tag,
      summary: 'The network switches, postings offered to the college, blocks and who looked',
      access: manage,
      handler: async () => {
        const [view, items, blocked] = await Promise.all([
          s.adminView(),
          postings.adminPostings(),
          postings.blocked(),
        ]);
        return { data: { ...view, postings: items, blocked } };
      },
    },
    {
      method: 'put',
      path: '/admin/network/switches',
      tag,
      summary: 'Turn the network on or off for the college (admin with TOTP; accepting the terms)',
      access: settings,
      limiter: 'adminWrite',
      body: networkSwitchBody,
      handler: async ({ req, body }) => ({ data: await s.setSwitches(authOf(req), body, requestMeta(req)) }),
    },
    {
      method: 'post',
      path: '/admin/network/postings/:id/decision',
      tag,
      summary: 'Approve a posting (it becomes a drive) or decline it',
      access: manage,
      limiter: 'adminWrite',
      params: idParams,
      body: postingDecisionBody,
      handler: async ({ req, params, body }) => ({
        data: await postings.decide(authOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/admin/network/postings/:id/moderate',
      tag,
      summary: 'Keep or remove a posting hidden by reports',
      access: manage,
      limiter: 'adminWrite',
      readOnlyOk: true,
      params: idParams,
      body: moderateBody,
      handler: async ({ req, params, body }) => ({
        data: await postings.moderate(authOf(req), params.id, body.keep, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/admin/network/blocks',
      tag,
      summary: 'Block an employer from the college',
      access: manage,
      limiter: 'adminWrite',
      readOnlyOk: true,
      body: blockEmployerBody,
      handler: async ({ req, body }) => ({
        data: await postings.block(authOf(req), body.employerId, requestMeta(req)),
      }),
    },
    {
      method: 'delete',
      path: '/admin/network/blocks/:id',
      tag,
      summary: 'Unblock an employer',
      access: manage,
      limiter: 'adminWrite',
      params: idParams,
      handler: async ({ req, params }) => ({
        data: await postings.unblock(authOf(req), params.id, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/admin/network/paused/:userId/resume',
      tag,
      summary: 'Give network access back to a member paused by reports',
      access: manage,
      limiter: 'adminWrite',
      params: userParams,
      handler: async ({ req, params }) => ({
        data: await s.resume(authOf(req), params.userId, requestMeta(req)),
      }),
    },
  ];
}
