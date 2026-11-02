import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { safeFetch as SafeFetch } from './safe-fetch.js';

/**
 * Online payment of invoices (build B10, decision D5). Bank transfer against the invoice is the
 * primary flow; this adapter adds a payment link. Only what a payment needs leaves the platform:
 * the invoice number and amount, and the college's legal name (an organisation, never a member).
 */
export interface PaymentLinkRequest {
  /** Our reference: the invoice number (Razorpay keeps it unique per account). */
  reference: string;
  amountPaise: number;
  description: string;
  /** The college's legal name. */
  payerName: string;
  /** Where the payer lands after paying. */
  callbackUrl: string;
  notes: { tenantId: string; invoiceId: string };
}

export interface PaymentLink {
  id: string;
  url: string;
}

/** A payment the provider reports as captured, from a verified webhook body. */
export interface PaidEvent {
  /** Deduplicates deliveries (providers retry). */
  eventId: string;
  linkId: string;
  paymentId: string;
  amountPaise: number;
  tenantId: string;
  invoiceId: string;
  paidAt: Date;
}

export interface PaymentProvider {
  readonly name: 'disabled' | 'stub' | 'razorpay';
  readonly available: boolean;
  createLink(r: PaymentLinkRequest): Promise<PaymentLink>;
  /** Whether the raw body carries a valid signature. */
  verify(raw: Buffer | undefined, signature: string | undefined): boolean;
  /** The paid event in a verified body, or null for events we do not act on. */
  parse(body: unknown, eventId: string | undefined): PaidEvent | null;
}

/** HMAC SHA256 of the raw body, hex, compared in constant time (Razorpay's webhook signature). */
export function hmacValid(secret: string, raw: Buffer | undefined, signature: string | undefined): boolean {
  if (!secret || !raw || !signature) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

export const sign = (secret: string, raw: string | Buffer): string =>
  createHmac('sha256', secret).update(raw).digest('hex');

export class DisabledPaymentProvider implements PaymentProvider {
  readonly name = 'disabled' as const;
  readonly available = false;
  async createLink(): Promise<PaymentLink> {
    throw new Error('Online payment is not set up');
  }
  verify() {
    return false;
  }
  parse() {
    return null;
  }
}

// Razorpay's `payment_link.paid` event: the link (with our notes) and the captured payment.
const paidBody = z.object({
  event: z.literal('payment_link.paid'),
  payload: z.object({
    payment_link: z.object({
      entity: z.object({
        id: z.string().min(1).max(60),
        notes: z.object({
          tenant_id: z.string().regex(/^[a-f0-9]{24}$/),
          invoice_id: z.string().regex(/^[a-f0-9]{24}$/),
        }),
      }),
    }),
    payment: z.object({
      entity: z.object({
        id: z.string().min(1).max(60),
        amount: z.number().int().positive(),
        status: z.string(),
        created_at: z.number().int().positive(),
      }),
    }),
  }),
});

function parseRazorpayShape(body: unknown, eventId: string | undefined): PaidEvent | null {
  const r = paidBody.safeParse(body);
  if (!r.success) return null;
  const link = r.data.payload.payment_link.entity;
  const pay = r.data.payload.payment.entity;
  if (pay.status !== 'captured') return null;
  return {
    eventId: eventId && /^[\w-]{1,80}$/.test(eventId) ? eventId : `${link.id}-${pay.id}`,
    linkId: link.id,
    paymentId: pay.id,
    amountPaise: pay.amount,
    tenantId: link.notes.tenant_id,
    invoiceId: link.notes.invoice_id,
    paidAt: new Date(pay.created_at * 1000),
  };
}

/**
 * Razorpay Payment Links (POST https://api.razorpay.com/v1/payment_links, HTTP Basic with the key
 * id and secret; amounts in paise). Razorpay's own notifications stay off: the college's admins
 * get the invoice and reminders from us, so no contact details are sent.
 */
export class RazorpayPaymentProvider implements PaymentProvider {
  readonly name = 'razorpay' as const;
  readonly available = true;
  constructor(
    private readonly c: { keyId: string; keySecret: string; webhookSecret: string },
    private readonly fetcher: typeof SafeFetch,
  ) {}

  async createLink(r: PaymentLinkRequest): Promise<PaymentLink> {
    const res = await this.fetcher('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      allowHosts: ['api.razorpay.com'],
      timeoutMs: 10_000,
      maxBytes: 64 * 1024,
      headers: {
        authorization: `Basic ${Buffer.from(`${this.c.keyId}:${this.c.keySecret}`).toString('base64')}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        amount: r.amountPaise,
        currency: 'INR',
        accept_partial: false,
        reference_id: r.reference,
        description: r.description.slice(0, 2048),
        customer: { name: r.payerName },
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: { tenant_id: r.notes.tenantId, invoice_id: r.notes.invoiceId },
        callback_url: r.callbackUrl,
        callback_method: 'get',
      }),
    });
    const json = JSON.parse(res.body.toString('utf8') || '{}') as { id?: unknown; short_url?: unknown };
    if (res.status >= 300 || typeof json.id !== 'string' || typeof json.short_url !== 'string')
      // The status only: provider error bodies can echo what was sent.
      throw new Error(`Payment link failed (${res.status})`);
    return { id: json.id, url: json.short_url };
  }

  verify(raw: Buffer | undefined, signature: string | undefined) {
    return hmacValid(this.c.webhookSecret, raw, signature);
  }

  parse(body: unknown, eventId: string | undefined) {
    return parseRazorpayShape(body, eventId);
  }
}

/**
 * Development and tests: links point at a local page that "pays" (the dev route signs a Razorpay-
 * shaped event with the stub secret and posts it through the real webhook path).
 */
export class StubPaymentProvider implements PaymentProvider {
  readonly name = 'stub' as const;
  readonly available = true;
  readonly links = new Map<string, PaymentLinkRequest>();
  constructor(readonly secret: string = randomBytes(24).toString('hex')) {}

  async createLink(r: PaymentLinkRequest): Promise<PaymentLink> {
    const id = `plink_stub${randomBytes(6).toString('hex')}`;
    this.links.set(id, r);
    return { id, url: `${new URL(r.callbackUrl).origin}/api/v1/dev/stub-pay/${id}` };
  }

  verify(raw: Buffer | undefined, signature: string | undefined) {
    return hmacValid(this.secret, raw, signature);
  }

  parse(body: unknown, eventId: string | undefined) {
    return parseRazorpayShape(body, eventId);
  }

  /** The signed body a payment of `linkId` would deliver (what the dev page and tests send). */
  paidEvent(linkId: string, paymentId = `pay_stub${randomBytes(6).toString('hex')}`) {
    const r = this.links.get(linkId);
    if (!r) return null;
    const body = JSON.stringify({
      event: 'payment_link.paid',
      payload: {
        payment_link: {
          entity: { id: linkId, notes: { tenant_id: r.notes.tenantId, invoice_id: r.notes.invoiceId } },
        },
        payment: {
          entity: {
            id: paymentId,
            amount: r.amountPaise,
            status: 'captured',
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      },
    });
    return { body, signature: sign(this.secret, body), eventId: `evt_${paymentId}` };
  }
}
