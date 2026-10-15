import nodemailer, { type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
/** Swappable mail adapter (ADR 0005). */
export interface MailProvider {
  send(msg: MailMessage): Promise<void>;
}

export class SmtpMailProvider implements MailProvider {
  private readonly transport: Transporter;
  constructor(
    opts: { host: string; port: number; secure: boolean; user?: string; pass?: string },
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      ...(opts.user ? { auth: { user: opts.user, pass: opts.pass ?? '' } } : {}),
    });
  }
  async send(msg: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...msg });
  }
}

/** Test/dev adapter that keeps messages in memory. */
export class MemoryMailProvider implements MailProvider {
  readonly outbox: MailMessage[] = [];
  async send(msg: MailMessage): Promise<void> {
    this.outbox.push(msg);
  }
  lastTo(to: string): MailMessage | undefined {
    return [...this.outbox].reverse().find((m) => m.to === to);
  }
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

/** Minimal, accessible transactional email layout. All interpolated values are escaped. */
export function renderEmail(opts: {
  college: string;
  heading: string;
  body: string;
  cta?: { label: string; url: string };
  footer: string;
}): Pick<MailMessage, 'text' | 'html'> {
  const text = [
    opts.heading,
    '',
    opts.body,
    opts.cta ? `\n${opts.cta.label}: ${opts.cta.url}` : '',
    '',
    opts.footer,
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5fa;font-family:system-ui,sans-serif;color:#0c1226">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:16px;padding:28px">
<tr><td style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#5b6480">${escapeHtml(opts.college)}</td></tr>
<tr><td style="padding-top:8px;font-size:22px;font-weight:700">${escapeHtml(opts.heading)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.55">${escapeHtml(opts.body)}</td></tr>
${opts.cta ? `<tr><td style="padding-top:20px"><a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;background:#0a6890;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:999px">${escapeHtml(opts.cta.label)}</a></td></tr>` : ''}
<tr><td style="padding-top:24px;font-size:12px;color:#5b6480">${escapeHtml(opts.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}
