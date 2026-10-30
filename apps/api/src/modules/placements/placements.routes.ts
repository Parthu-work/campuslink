import type { Request } from 'express';
import {
  academicSelfBody,
  academicVerifyBody,
  adminDrivesQuery,
  driveBody,
  driveStatusBody,
  driveUpdateBody,
  drivesQuery,
  finalBody,
  offerDecisionBody,
  offerReportBody,
  offersQuery,
  overrideBody,
  placementCompanyBody,
  registerBody,
  registrantsExportQuery,
  roundParams,
  roundResultsBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { idParams } from '../../http/validation.js';
import { requestMeta } from '../../lib/request-meta.js';
import { badRequest } from '../../lib/errors.js';
import type { PlacementsService } from './placements.service.js';
import type { OffersService } from './offers.service.js';
import type { AcademicsService } from './academics.service.js';
import type { FilesService } from '../files/files.service.js';

const VIEW = { kind: 'permission', permission: 'placements:view' } as const;
const REGISTER = { kind: 'permission', permission: 'placements:register' } as const;
const MANAGE = { kind: 'permission', permission: 'placements:manage' } as const;
const EXPORT = { kind: 'permission', permission: 'reports:export' } as const;
const REPORT = { kind: 'permission', permission: 'outcomes:report' } as const;
const VERIFY = { kind: 'permission', permission: 'outcomes:verify' } as const;
const tag = 'Placements';
const meta = (req: Request) => requestMeta(req);
const UPLOAD = { field: 'file', maxBytes: 5 * 1024 * 1024 };

/** Placement drives, registrations, round results and offers (build B7). */
export function placementRoutes(s: {
  placements: PlacementsService;
  offers: OffersService;
  academics: AcademicsService;
  files: FilesService;
}): AnyRouteSpec[] {
  return [
    // ── Students ─────────────────────────────
    {
      method: 'get',
      path: '/placements/drives',
      tag,
      summary: 'Drives open to me (eligible), every visible drive, or the ones I registered for',
      access: VIEW,
      query: drivesQuery,
      handler: async ({ req, query }) => ({ data: await s.placements.list(authOf(req), query.scope) }),
    },
    {
      method: 'get',
      path: '/placements/drives/:id',
      tag,
      summary: 'A drive with my eligibility (and why not) and my registration',
      access: VIEW,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.placements.get(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/placements/resume',
      tag,
      summary: 'Upload a PDF résumé (or a file answer) for a drive registration',
      access: REGISTER,
      limiter: 'upload',
      upload: UPLOAD,
      handler: async ({ req, file }) => {
        if (!file) throw badRequest('Choose a PDF');
        return {
          status: 201,
          data: await s.files.storeResume(authOf(req).userId, file.buffer, 'placement_resume'),
        };
      },
    },
    {
      method: 'post',
      path: '/placements/drives/:id/register',
      tag,
      summary: 'Register for a drive in one tap (eligible, or let in by the placement cell)',
      access: REGISTER,
      limiter: 'requests',
      idempotent: true,
      params: idParams,
      body: registerBody,
      handler: async ({ req, params, body }) => ({
        status: 201,
        data: await s.placements.register(authOf(req), params.id, body, meta(req)),
      }),
    },
    {
      method: 'post',
      path: '/placements/drives/:id/withdraw',
      tag,
      summary: 'Withdraw my registration before the drive starts',
      access: REGISTER,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.placements.withdraw(authOf(req), params.id) }),
    },
    {
      method: 'get',
      path: '/me/academics',
      tag,
      summary: 'My academic record for placement eligibility',
      access: VIEW,
      handler: async ({ req }) => ({ data: await s.academics.mine(authOf(req)) }),
    },
    {
      method: 'put',
      path: '/me/academics',
      tag,
      summary: 'Report my academic record (counts once the placement cell verifies it)',
      access: REGISTER,
      limiter: 'verify',
      body: academicSelfBody,
      handler: async ({ req, body }) => ({
        data: await s.academics.selfReport(authOf(req), body, meta(req)),
      }),
    },
    // ── Offers ─────────────────────────────
    {
      method: 'get',
      path: '/placements/offers',
      tag,
      summary: 'My offers (exact CTC visible to me only)',
      access: REPORT,
      handler: async ({ req }) => ({ data: await s.offers.mine(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/placements/offers/proof',
      tag,
      summary: 'Upload proof of an offer (PDF or image; rebuilt, metadata removed)',
      access: REPORT,
      limiter: 'upload',
      upload: UPLOAD,
      handler: async ({ req, file }) => {
        if (!file) throw badRequest('Choose a file');
        return { status: 201, data: await s.files.storeOfferProof(authOf(req).userId, file.buffer) };
      },
    },
    {
      method: 'post',
      path: '/placements/offers',
      tag,
      summary: 'Report an offer (off campus, PPO, internship conversion) for the placement cell to verify',
      access: REPORT,
      limiter: 'requests',
      idempotent: true,
      body: offerReportBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.offers.report(authOf(req), body, meta(req)),
      }),
    },
    {
      method: 'post',
      path: '/placements/offers/:id/decline',
      tag,
      summary: 'Mark one of my offers as declined',
      access: REPORT,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.offers.decline(authOf(req), params.id) }),
    },
    // ── Placement cell ─────────────────────────────
    {
      method: 'get',
      path: '/admin/placements/companies',
      tag,
      summary: 'Companies that recruit through the college (with the cell’s notes)',
      access: MANAGE,
      handler: async () => ({ data: await s.placements.companies() }),
    },
    {
      method: 'put',
      path: '/admin/placements/companies',
      tag,
      summary: 'Add or update a company (matched on its normalised name)',
      access: MANAGE,
      limiter: 'adminWrite',
      body: placementCompanyBody,
      handler: async ({ body }) => ({ data: await s.placements.upsertCompany(body) }),
    },
    {
      method: 'get',
      path: '/admin/placements/drives',
      tag,
      summary: 'Every drive with its registration count',
      access: MANAGE,
      query: adminDrivesQuery,
      handler: async ({ req, query }) => {
        const r = await s.placements.adminList(authOf(req), query);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'post',
      path: '/admin/placements/drives',
      tag,
      summary: 'Create a drive (draft), optionally with a linked calendar event',
      access: MANAGE,
      limiter: 'adminWrite',
      idempotent: true,
      body: driveBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.placements.create(authOf(req), body, meta(req)),
      }),
    },
    {
      method: 'put',
      path: '/admin/placements/drives/:id',
      tag,
      summary: 'Edit a drive before it starts',
      access: MANAGE,
      limiter: 'adminWrite',
      params: idParams,
      body: driveUpdateBody,
      handler: async ({ req, params, body }) => ({
        data: await s.placements.update(authOf(req), params.id, body, meta(req)),
      }),
    },
    {
      method: 'post',
      path: '/admin/placements/drives/:id/status',
      tag,
      summary: 'Open (notifies eligible students), close, start, complete or cancel a drive',
      access: MANAGE,
      limiter: 'adminWrite',
      params: idParams,
      body: driveStatusBody,
      handler: async ({ req, params, body }) => ({
        data: await s.placements.setStatus(authOf(req), params.id, body.status, meta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/placements/drives/:id/registrants',
      tag,
      summary: 'Registrants with roll number, CGPA, round results and final result',
      access: MANAGE,
      params: idParams,
      handler: async ({ params }) => ({ data: await s.placements.registrants(params.id) }),
    },
    {
      method: 'post',
      path: '/admin/placements/drives/:id/override',
      tag,
      summary: 'Let an ineligible student register for this drive (audited, with a reason)',
      access: MANAGE,
      limiter: 'adminWrite',
      params: idParams,
      body: overrideBody,
      handler: async ({ req, params, body }) => ({
        data: await s.placements.override(authOf(req), params.id, body, meta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/placements/drives/:id/export',
      tag,
      summary: 'Export registrants for the company: only the ticked columns, CSV or Excel (audited)',
      access: EXPORT,
      params: idParams,
      query: registrantsExportQuery,
      handler: async ({ req, params, query }) => {
        const f = await s.placements.export(authOf(req), params.id, query.columns, query.format, meta(req));
        return {
          data: null,
          raw: {
            body: f.body,
            headers: {
              'Content-Type': f.type,
              'Content-Disposition': `attachment; filename="${f.name}"`,
              'X-Content-Type-Options': 'nosniff',
              'Cache-Control': 'no-store',
            },
          },
        };
      },
    },
    {
      method: 'put',
      path: '/admin/placements/drives/:id/rounds/:round',
      tag,
      summary: 'Enter round results (each student is told when theirs changes)',
      access: MANAGE,
      limiter: 'adminWrite',
      params: roundParams,
      body: roundResultsBody,
      handler: async ({ req, params, body }) => ({
        data: await s.placements.setRoundResults(
          authOf(req),
          params.id,
          params.round,
          body.results,
          meta(req),
        ),
      }),
    },
    {
      method: 'post',
      path: '/admin/placements/drives/:id/rounds/:round/import',
      tag,
      summary: 'Round results from a CSV or Excel sheet keyed by roll number (unknown rolls listed)',
      access: MANAGE,
      limiter: 'upload',
      params: roundParams,
      upload: UPLOAD,
      handler: async ({ req, params, file }) => ({
        data: await s.placements.importRoundResults(authOf(req), params.id, params.round, file, meta(req)),
      }),
    },
    {
      method: 'put',
      path: '/admin/placements/registrations/:id/final',
      tag,
      summary: 'Record the final result; a selection records a verified offer',
      access: MANAGE,
      limiter: 'adminWrite',
      params: idParams,
      body: finalBody,
      handler: async ({ req, params, body }) => ({
        data: await s.placements.setFinal(authOf(req), params.id, body, meta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/placements/academics/pending',
      tag,
      summary: 'Self-reported academic records waiting for verification',
      access: MANAGE,
      handler: async () => ({ data: await s.academics.pending() }),
    },
    {
      method: 'post',
      path: '/admin/placements/academics/:id/decision',
      tag,
      summary: 'Verify or reject a self-reported academic record',
      access: MANAGE,
      limiter: 'adminWrite',
      params: idParams,
      body: academicVerifyBody,
      handler: async ({ req, params, body }) => ({
        data: await s.academics.verify(authOf(req).userId, params.id, body.decision, meta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/offers',
      tag,
      summary: 'Offers by status (reported ones wait for verification)',
      access: VERIFY,
      query: offersQuery,
      handler: async ({ query }) => {
        const r = await s.offers.queue(query.status, query.cursor);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'post',
      path: '/admin/offers/:id/decision',
      tag,
      summary: 'Verify or reject a reported offer (the member sees the reason)',
      access: VERIFY,
      limiter: 'adminWrite',
      params: idParams,
      body: offerDecisionBody,
      handler: async ({ req, params, body }) => ({
        data: await s.offers.decide(authOf(req).userId, params.id, body.decision, body.reason, meta(req)),
      }),
    },
  ];
}
