import { z } from 'zod';
import {
  ErrorCode,
  invoiceDraftBody,
  invoiceParams,
  ownInvoiceParams,
  planParams,
  planTermsPatch,
  platformSubscriptionBody,
  recordPaymentBody,
  voidInvoiceBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import { idParams } from '../../http/validation.js';
import { AppError, notFound } from '../../lib/errors.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { PaymentProvider, StubPaymentProvider } from '../../lib/payments.js';
import type { BillingService } from './billing.service.js';

const pdf = (f: { data: Buffer; name: string }) => ({
  data: null,
  raw: {
    body: f.data,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${f.name}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  },
});

const platform = { kind: 'permission', permission: 'platform:billing' } as const;
const college = { kind: 'permission', permission: 'tenant:settings' } as const;

/** Plans, invoices and payments (build B10). */
export function billingRoutes(svc: BillingService, payments: PaymentProvider): AnyRouteSpec[] {
  /** A verified Razorpay-shaped delivery (the stub signs the same shape). */
  const webhook = async (
    raw: Buffer | undefined,
    signature: string | undefined,
    eventId: string | undefined,
    body: unknown,
  ) => {
    if (!payments.verify(raw, signature)) throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Bad signature');
    const e = payments.parse(body, eventId);
    return { result: e ? await svc.recordOnline(e) : 'ignored' };
  };

  return [
    // ── Platform console ─────────────────────────────
    {
      method: 'get',
      path: '/platform/plans',
      tag: 'Billing',
      summary: 'The plans with their terms (defaults and the platform owner’s changes)',
      access: platform,
      scope: 'platform',
      handler: async () => ({ data: await svc.plans() }),
    },
    {
      method: 'patch',
      path: '/platform/plans/:plan',
      tag: 'Billing',
      summary: 'Change a plan’s price, minimum, features or allowances',
      access: platform,
      scope: 'platform',
      limiter: 'adminWrite',
      params: planParams,
      body: planTermsPatch,
      handler: async ({ req, params, body }) => ({
        data: await svc.updatePlan(authOf(req).userId, params.plan, body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/platform/billing',
      tag: 'Billing',
      summary: 'Every college’s plan, seats and outstanding balance',
      access: platform,
      scope: 'platform',
      handler: async () => ({ data: await svc.overview() }),
    },
    {
      method: 'get',
      path: '/platform/billing/:id',
      tag: 'Billing',
      summary: 'One college’s subscription, usage and invoices',
      access: platform,
      scope: 'platform',
      params: idParams,
      handler: async ({ params }) => ({ data: await svc.collegeView(params.id) }),
    },
    {
      method: 'patch',
      path: '/platform/billing/:id',
      tag: 'Billing',
      summary: 'Set a college’s plan, seats, term, custom deal and invoice details',
      access: platform,
      scope: 'platform',
      limiter: 'adminWrite',
      params: idParams,
      body: platformSubscriptionBody,
      handler: async ({ req, params, body }) => ({
        data: await svc.updateSubscription(authOf(req).userId, params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/platform/billing/:id/invoices',
      tag: 'Billing',
      summary: 'Draft an invoice for a college',
      access: platform,
      scope: 'platform',
      limiter: 'adminWrite',
      idempotent: true,
      params: idParams,
      body: invoiceDraftBody,
      handler: async ({ req, params, body }) => ({
        status: 201,
        data: await svc.createDraft(authOf(req).userId, params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'delete',
      path: '/platform/billing/:id/invoices/:invoiceId',
      tag: 'Billing',
      summary: 'Discard a draft invoice',
      access: platform,
      scope: 'platform',
      limiter: 'adminWrite',
      params: invoiceParams,
      handler: async ({ req, params }) => ({
        data: await svc.discardDraft(authOf(req).userId, params.id, params.invoiceId, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/platform/billing/:id/invoices/:invoiceId/issue',
      tag: 'Billing',
      summary: 'Issue a draft: its number, tax and PDF are fixed from now on',
      access: platform,
      scope: 'platform',
      limiter: 'adminWrite',
      idempotent: true,
      params: invoiceParams,
      handler: async ({ req, params }) => ({
        data: await svc.issue(authOf(req).userId, params.id, params.invoiceId, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/platform/billing/:id/invoices/:invoiceId/void',
      tag: 'Billing',
      summary: 'Void an issued invoice that has no payments',
      access: platform,
      scope: 'platform',
      limiter: 'adminWrite',
      params: invoiceParams,
      body: voidInvoiceBody,
      handler: async ({ req, params, body }) => ({
        data: await svc.voidInvoice(
          authOf(req).userId,
          params.id,
          params.invoiceId,
          body.reason,
          requestMeta(req),
        ),
      }),
    },
    {
      method: 'post',
      path: '/platform/billing/:id/invoices/:invoiceId/payments',
      tag: 'Billing',
      summary: 'Record a bank payment (amount, date, UTR)',
      access: platform,
      scope: 'platform',
      limiter: 'adminWrite',
      idempotent: true,
      params: invoiceParams,
      body: recordPaymentBody,
      handler: async ({ req, params, body }) => ({
        status: 201,
        data: await svc.recordBank(authOf(req).userId, params.id, params.invoiceId, body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/platform/billing/:id/invoices/:invoiceId/pdf',
      tag: 'Billing',
      summary: 'Download an issued invoice (PDF)',
      access: platform,
      scope: 'platform',
      params: invoiceParams,
      handler: async ({ params }) => pdf(await svc.platformPdf(params.id, params.invoiceId)),
    },

    // ── The college ─────────────────────────────
    {
      method: 'get',
      path: '/admin/billing',
      tag: 'Billing',
      summary: 'Our plan, seats, usage against allowances, and invoices',
      access: college,
      handler: async ({ req }) => ({ data: await svc.adminView(tenantOf(req)) }),
    },
    {
      method: 'get',
      path: '/admin/billing/notice',
      tag: 'Billing',
      summary: 'Whether to show admins a billing banner (seats, pilot end, overdue, read-only)',
      access: college,
      handler: async ({ req }) => ({ data: await svc.notice(tenantOf(req)) }),
    },
    {
      method: 'get',
      path: '/admin/billing/invoices/:invoiceId/pdf',
      tag: 'Billing',
      summary: 'Download one of our invoices (PDF)',
      access: college,
      params: ownInvoiceParams,
      handler: async ({ params }) => pdf(await svc.pdf(params.invoiceId)),
    },
    {
      method: 'post',
      path: '/admin/billing/invoices/:invoiceId/pay',
      tag: 'Billing',
      summary: 'A link to pay an invoice online (when the platform has online payment)',
      access: college,
      limiter: 'adminWrite',
      readOnlyOk: true,
      params: ownInvoiceParams,
      handler: async ({ req, params }) => ({ data: await svc.payLink(tenantOf(req), params.invoiceId) }),
    },

    // ── Payment provider ─────────────────────────────
    {
      method: 'post',
      path: '/webhooks/razorpay',
      tag: 'Webhooks',
      summary: 'Razorpay deliveries (payment_link.paid; signed with X-Razorpay-Signature)',
      access: { kind: 'public' },
      scope: 'any',
      limiter: 'webhook',
      readOnlyOk: true,
      handler: async ({ req }) => ({
        data: await webhook(
          (req as unknown as { rawBody?: Buffer }).rawBody,
          req.get('x-razorpay-signature'),
          req.get('x-razorpay-event-id'),
          req.body,
        ),
      }),
    },
  ];
}

/**
 * Development only, with the stub provider: the "payment page" a stub link opens. It pays at once
 * by sending a signed delivery through the same webhook path, then returns to Admin › Billing.
 */
export function stubPayRoutes(svc: BillingService, stub: StubPaymentProvider): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/dev/stub-pay/:linkId',
      tag: 'Development',
      summary: 'Pay a stub payment link (development and end-to-end tests only)',
      access: { kind: 'public' },
      limiter: 'webhook',
      params: z.strictObject({ linkId: z.string().regex(/^plink_stub[a-f0-9]{12}$/) }),
      handler: async ({ params }) => {
        const delivery = stub.paidEvent(params.linkId);
        const request = stub.links.get(params.linkId);
        if (!delivery || !request) throw notFound('Payment link');
        const e = stub.parse(JSON.parse(delivery.body), delivery.eventId);
        if (!e || !stub.verify(Buffer.from(delivery.body), delivery.signature))
          throw notFound('Payment link');
        await svc.recordOnline(e);
        return { status: 303, data: null, raw: { body: '', headers: { Location: request.callbackUrl } } };
      },
    },
  ];
}
