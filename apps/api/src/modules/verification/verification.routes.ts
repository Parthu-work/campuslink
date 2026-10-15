import { z } from 'zod';
import {
  bulkInviteBody,
  companyEmailConfirmBody,
  companyEmailStartBody,
  confirmVerificationBody,
  idVerificationFields,
  startVerificationBody,
  verificationDecisionBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import { idParams } from '../../http/validation.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { VerificationService } from './verification.service.js';
import type { InvitesService } from './invites.service.js';

const REVIEW = { kind: 'permission', permission: 'verification:review' } as const;

export function verificationRoutes(svc: VerificationService, invites: InvitesService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/verification',
      tag: 'Verification',
      summary: 'My verification status',
      access: { kind: 'authenticated' },
      handler: async ({ req }) => ({ data: await svc.status(authOf(req).userId) }),
    },
    {
      method: 'post',
      path: '/verification/roll',
      tag: 'Verification',
      summary: 'Match my roll number against the college list and send a code to the email on record',
      access: { kind: 'authenticated' },
      limiter: 'verify',
      body: startVerificationBody,
      handler: async ({ req, body }) => ({
        data: await svc.start(
          tenantOf(req),
          authOf(req).userId,
          body.rollNumber,
          body.gradYear,
          requestMeta(req),
        ),
      }),
    },
    {
      method: 'post',
      path: '/verification/roll/confirm',
      tag: 'Verification',
      summary: 'Confirm the 6-digit code to claim my college record',
      access: { kind: 'authenticated' },
      limiter: 'verify',
      body: confirmVerificationBody,
      handler: async ({ req, body }) => ({
        data: await svc.confirm(authOf(req).userId, body.challengeId, body.code, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/verification/id-card',
      tag: 'Verification',
      summary: 'Ask an admin to verify me from a college ID photo',
      access: { kind: 'authenticated' },
      limiter: 'upload',
      upload: { field: 'photo', maxBytes: 5 * 1024 * 1024 },
      body: idVerificationFields,
      handler: async ({ req, body, file }) => ({
        status: 201,
        data: await svc.requestWithId(authOf(req).userId, file, body, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/verification/company',
      tag: 'Verification',
      summary: 'Alumni: send a code to my work email for a “currently at” badge',
      access: { kind: 'permission', permission: 'mentorship:mentor' },
      limiter: 'verify',
      body: companyEmailStartBody,
      handler: async ({ req, body }) => ({
        data: await svc.startCompany(
          tenantOf(req),
          authOf(req).userId,
          body.email,
          body.company,
          requestMeta(req),
        ),
      }),
    },
    {
      method: 'post',
      path: '/verification/company/confirm',
      tag: 'Verification',
      summary: 'Confirm the work-email code',
      access: { kind: 'permission', permission: 'mentorship:mentor' },
      limiter: 'verify',
      body: companyEmailConfirmBody,
      handler: async ({ req, body }) => ({
        data: await svc.confirmCompany(authOf(req).userId, body.challengeId, body.code, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/verification',
      tag: 'Verification',
      summary: 'Verification requests waiting for review (or decided)',
      access: REVIEW,
      query: z.strictObject({
        status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
        cursor: z
          .string()
          .regex(/^[a-f0-9]{24}$/)
          .optional(),
      }),
      handler: async ({ query }) => {
        const r = await svc.queue(query.status, query.cursor);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'post',
      path: '/admin/verification/:id/decision',
      tag: 'Verification',
      summary: 'Approve or reject an ID verification request',
      access: REVIEW,
      limiter: 'adminWrite',
      params: idParams,
      body: verificationDecisionBody,
      handler: async ({ req, params, body }) => ({
        data: await svc.decide(
          tenantOf(req),
          authOf(req).userId,
          params.id,
          body.decision,
          body.reason,
          requestMeta(req),
        ),
      }),
    },
    {
      method: 'post',
      path: '/admin/users/:id/unverify',
      tag: 'Verification',
      summary: 'Revoke a member’s verification and free their list record',
      access: REVIEW,
      limiter: 'adminWrite',
      params: idParams,
      handler: async ({ req, params }) => {
        await svc.revoke(authOf(req).userId, params.id, requestMeta(req));
        return { status: 204, data: null };
      },
    },
    {
      method: 'post',
      path: '/admin/invites',
      tag: 'Verification',
      summary: 'Invite people by email (invitees are verified when they sign up with that email)',
      access: { kind: 'permission', permission: 'users:invite' },
      limiter: 'adminWrite',
      body: bulkInviteBody,
      handler: async ({ req, body }) => ({
        data: await invites.invite(req, authOf(req).userId, body.emails),
      }),
    },
  ];
}
