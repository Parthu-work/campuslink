import { z } from 'zod';
import {
  LINKEDIN_MAX_BYTES,
  alumniOfMonthBody,
  alumniOfMonthReplyBody,
  announceBody,
  batchParams,
  certificateBody,
  certificateCodeParams,
  fundBody,
  givingSettingsBody,
  linkedinApplyBody,
  microAskBody,
  microAskReplyBody,
  pledgeBody,
  pledgePaidBody,
  pledgeReceiveBody,
  pledgesQuery,
  type Permission,
} from '@campuslink/shared';
import type { AnyRouteSpec, HandlerResult } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { idParams } from '../../http/validation.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { MicroAsksService } from './micro-asks.service.js';
import type { RecognitionService } from './recognition.service.js';
import type { GivingService } from './giving.service.js';
import type { AlumniService } from './alumni.service.js';

const tag = 'Alumni';
const perm = (permission: Permission) => ({ kind: 'permission', permission }) as const;
const ASK = perm('alumni:ask');
const HELP = perm('alumni:help');
const RECOGNISE = perm('alumni:recognise');
const PLEDGE = perm('giving:pledge');
const GIVING = perm('giving:manage');
const IMPORT = perm('profile:import');
const DIRECTORY = perm('directory:read');
const signedIn = { kind: 'authenticated' } as const;
const openBody = z.strictObject({ open: z.boolean() });

const pdf = (f: { data: Buffer; name: string }): HandlerResult => ({
  data: null,
  raw: {
    body: f.data,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${f.name}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  },
});

/** Alumni engagement (prompt 2, G6, docs/specs/alumni.md). */
export function alumniRoutes(s: {
  asks: MicroAsksService;
  recognition: RecognitionService;
  giving: GivingService;
  alumni: AlumniService;
}): AnyRouteSpec[] {
  return [
    // ── Micro-asks ─────────────────────────────
    {
      method: 'get',
      path: '/micro-asks/sent',
      tag,
      summary: 'Micro-asks I sent',
      access: ASK,
      handler: async ({ req }) => ({ data: await s.asks.list(authOf(req), 'sent') }),
    },
    {
      method: 'get',
      path: '/micro-asks/received',
      tag,
      summary: 'Micro-asks handed to me, and this week’s count against the cap',
      access: HELP,
      handler: async ({ req }) => ({ data: await s.asks.list(authOf(req), 'received') }),
    },
    {
      method: 'post',
      path: '/micro-asks',
      tag,
      summary: 'Ask a small favour; it goes to one matching alumnus at a time (two a week each at most)',
      access: ASK,
      limiter: 'requests',
      idempotent: true,
      bot: true,
      body: microAskBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.asks.create(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/micro-asks/:id',
      tag,
      summary: 'One micro-ask (mine, or one handed to me)',
      access: signedIn,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.asks.get(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/micro-asks/:id/reply',
      tag,
      summary: 'Say yes, pass (it moves on) or mark it done (impact points)',
      access: HELP,
      limiter: 'interact',
      params: idParams,
      body: microAskReplyBody,
      handler: async ({ req, params, body }) => ({
        data: await s.asks.reply(authOf(req), params.id, body.action),
      }),
    },
    {
      method: 'post',
      path: '/micro-asks/:id/cancel',
      tag,
      summary: 'Withdraw one of my asks',
      access: ASK,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.asks.cancel(authOf(req), params.id) }),
    },
    {
      method: 'get',
      path: '/me/micro-asks/settings',
      tag,
      summary: 'Whether I take micro-asks',
      access: HELP,
      handler: async ({ req }) => ({ data: await s.asks.settings(authOf(req)) }),
    },
    {
      method: 'put',
      path: '/me/micro-asks/settings',
      tag,
      summary: 'Take micro-asks, or stop',
      access: HELP,
      body: openBody,
      handler: async ({ req, body }) => ({ data: await s.asks.setOpen(authOf(req), body.open) }),
    },

    // ── Certificates ─────────────────────────────
    {
      method: 'get',
      path: '/me/certificates',
      tag,
      summary: 'My mentorship certificates, and what this year’s and last year’s would say',
      access: HELP,
      handler: async ({ req }) => ({
        data: {
          certificates: await s.recognition.certificates(authOf(req)),
          years: await s.recognition.eligibility(authOf(req)),
        },
      }),
    },
    {
      method: 'post',
      path: '/me/certificates',
      tag,
      summary: 'Issue (or refresh) my certificate of mentorship for an academic year',
      access: HELP,
      limiter: 'posting',
      idempotent: true,
      body: certificateBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.recognition.issue(authOf(req), body.academicYear),
      }),
    },
    {
      method: 'get',
      path: '/me/certificates/:id/pdf',
      tag,
      summary: 'Download my certificate',
      access: HELP,
      params: idParams,
      handler: async ({ req, params }) => pdf(await s.recognition.pdf(authOf(req), params.id)),
    },
    {
      method: 'get',
      path: '/verify/certificates/:code',
      tag,
      summary: 'Check a certificate of mentorship by its code (public: what it says and whether it stands)',
      access: { kind: 'public' },
      limiter: 'search',
      params: certificateCodeParams,
      handler: async ({ params }) => ({ data: await s.recognition.verify(params.code) }),
    },

    // ── Alumnus of the month ─────────────────────────────
    {
      method: 'get',
      path: '/alumni/of-the-month',
      tag,
      summary: 'Alumni of the month (the last twelve), for the Wall of Mentors',
      access: DIRECTORY,
      handler: async () => ({ data: await s.recognition.ofMonth() }),
    },
    {
      method: 'get',
      path: '/me/alumni-of-the-month',
      tag,
      summary: 'My nominations as alumnus of the month',
      access: HELP,
      handler: async ({ req }) => ({ data: await s.recognition.myNominations(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/me/alumni-of-the-month/:id',
      tag,
      summary: 'Accept or decline a nomination (nothing is shown unless I accept)',
      access: HELP,
      params: idParams,
      body: alumniOfMonthReplyBody,
      handler: async ({ req, params, body }) => ({
        data: await s.recognition.replyOfMonth(authOf(req), params.id, body.accept),
      }),
    },
    {
      method: 'get',
      path: '/admin/recognition/of-the-month',
      tag,
      summary: 'Nominations, accepted and declined',
      access: RECOGNISE,
      handler: async () => ({ data: await s.recognition.adminOfMonth() }),
    },
    {
      method: 'post',
      path: '/admin/recognition/of-the-month',
      tag,
      summary: 'Nominate the alumnus of the month (they are asked first; audited)',
      access: RECOGNISE,
      limiter: 'adminWrite',
      idempotent: true,
      body: alumniOfMonthBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.recognition.nominate(authOf(req), body, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/admin/recognition/of-the-month/:id/announce',
      tag,
      summary: 'Post the announcement once the alumnus accepted (needs announcements:post)',
      access: RECOGNISE,
      limiter: 'adminWrite',
      idempotent: true,
      params: idParams,
      body: announceBody,
      handler: async ({ req, params, body }) => ({
        data: await s.recognition.announce(authOf(req), params.id, body.body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/recognition/certificates',
      tag,
      summary: 'Certificates issued in the college',
      access: RECOGNISE,
      handler: async () => ({ data: await s.recognition.adminCertificates() }),
    },
    {
      method: 'post',
      path: '/admin/recognition/certificates/:id/revoke',
      tag,
      summary: 'Revoke a certificate (its public check then says so; audited)',
      access: RECOGNISE,
      limiter: 'adminWrite',
      params: idParams,
      handler: async ({ req, params }) => ({
        data: await s.recognition.revoke(authOf(req), params.id, requestMeta(req)),
      }),
    },

    // ── Giving ─────────────────────────────
    {
      method: 'get',
      path: '/giving/funds',
      tag,
      summary: 'The college’s open funds, with what was received and pledged',
      access: PLEDGE,
      handler: async ({ req }) => ({ data: await s.giving.funds(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/giving/pledges',
      tag,
      summary: 'Pledge to a fund (you pay the college directly, never the platform)',
      access: PLEDGE,
      limiter: 'interact',
      idempotent: true,
      body: pledgeBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.giving.pledge(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/me/pledges',
      tag,
      summary: 'My pledges',
      access: PLEDGE,
      handler: async ({ req }) => ({ data: await s.giving.myPledges(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/me/pledges/:id/paid',
      tag,
      summary: 'Say I paid the college (with the payment reference)',
      access: PLEDGE,
      params: idParams,
      body: pledgePaidBody,
      handler: async ({ req, params, body }) => ({
        data: await s.giving.markPaid(authOf(req), params.id, body.reference),
      }),
    },
    {
      method: 'post',
      path: '/me/pledges/:id/cancel',
      tag,
      summary: 'Cancel a pledge the college has not received',
      access: PLEDGE,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.giving.cancel(authOf(req), params.id) }),
    },
    {
      method: 'get',
      path: '/me/pledges/:id/acknowledgement',
      tag,
      summary: 'Download the acknowledgement for a contribution the college received',
      access: PLEDGE,
      params: idParams,
      handler: async ({ req, params }) => pdf(await s.giving.acknowledgement(authOf(req), params.id)),
    },
    {
      method: 'get',
      path: '/admin/giving/funds',
      tag,
      summary: 'Every fund, open and closed',
      access: GIVING,
      handler: async ({ req }) => ({ data: await s.giving.funds(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/admin/giving/funds',
      tag,
      summary: 'Publish a fund with its target and the college’s own payment link or bank details',
      access: GIVING,
      limiter: 'adminWrite',
      idempotent: true,
      body: fundBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.giving.createFund(authOf(req), body, requestMeta(req)),
      }),
    },
    {
      method: 'put',
      path: '/admin/giving/funds/:id',
      tag,
      summary: 'Edit, open or close a fund',
      access: GIVING,
      limiter: 'adminWrite',
      params: idParams,
      body: fundBody,
      handler: async ({ req, params, body }) => ({
        data: await s.giving.updateFund(authOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/giving/settings',
      tag,
      summary: 'Whether the college issues tax receipts, and what receipts say',
      access: GIVING,
      handler: async () => ({ data: await s.giving.settings() }),
    },
    {
      method: 'put',
      path: '/admin/giving/settings',
      tag,
      summary: 'Set tax-receipt registration and the signatory (audited)',
      access: GIVING,
      limiter: 'adminWrite',
      body: givingSettingsBody,
      handler: async ({ req, body }) => ({
        data: await s.giving.setSettings(authOf(req), body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/giving/pledges',
      tag,
      summary: 'Pledges, by status or fund',
      access: GIVING,
      query: pledgesQuery,
      handler: async ({ query }) => ({ data: await s.giving.adminPledges(query) }),
    },
    {
      method: 'post',
      path: '/admin/giving/pledges/:id/receive',
      tag,
      summary: 'Record money the college received: numbers it and makes the acknowledgement (audited)',
      access: GIVING,
      limiter: 'adminWrite',
      idempotent: true,
      params: idParams,
      body: pledgeReceiveBody,
      handler: async ({ req, params, body }) => ({
        data: await s.giving.receive(authOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/giving/pledges/:id/acknowledgement',
      tag,
      summary: 'Download a contribution’s acknowledgement',
      access: GIVING,
      params: idParams,
      handler: async ({ req, params }) => pdf(await s.giving.acknowledgement(authOf(req), params.id)),
    },

    // ── LinkedIn import ─────────────────────────────
    {
      method: 'post',
      path: '/me/linkedin/preview',
      tag,
      summary: 'Read my own LinkedIn data export (ZIP or CSV) into a preview; nothing is stored',
      access: IMPORT,
      limiter: 'upload',
      upload: { field: 'file', maxBytes: LINKEDIN_MAX_BYTES },
      handler: async ({ req, file }) => ({ data: await s.alumni.linkedinPreview(authOf(req), file?.buffer) }),
    },
    {
      method: 'post',
      path: '/me/linkedin/apply',
      tag,
      summary: 'Copy what I confirmed from the preview to my profile (company, role, skills)',
      access: IMPORT,
      limiter: 'posting',
      body: linkedinApplyBody,
      handler: async ({ req, body }) => ({ data: await s.alumni.linkedinApply(authOf(req), body) }),
    },

    // ── Batch pages ─────────────────────────────
    {
      method: 'get',
      path: '/batches/:gradYear/:branch',
      tag,
      summary: 'A batch: who is here (visibility respected), where it works (small counts hidden), reunions',
      access: DIRECTORY,
      params: batchParams,
      handler: async ({ req, params }) => ({
        data: await s.alumni.batch(authOf(req), params.gradYear, params.branch),
      }),
    },
  ];
}
