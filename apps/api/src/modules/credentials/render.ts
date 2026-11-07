import { APP_NAME } from '@campuslink/shared';
import type { VerifiedCredential } from './credentials.service.js';

/**
 * The public verify page (prompt 2, G12, ADR 0014 N35): the issued claims only — never contact
 * details, a CTC or anything else about the member. Not indexed, never cached.
 */
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const STYLE =
  'body{margin:0;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans",sans-serif;background:#f8fafc;color:#0f172a}' +
  'main{max-width:640px;margin:0 auto;padding:40px 16px}' +
  '.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px}' +
  'h1{font-size:1.6rem;line-height:1.25;margin:.25rem 0 .75rem}.college{color:#475569;font-weight:600}' +
  '.status{display:inline-block;padding:4px 12px;border-radius:999px;font-weight:700}' +
  '.valid{background:#dcfce7;color:#14532d}.bad{background:#fee2e2;color:#7f1d1d}' +
  'dl{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:16px 0}dt{color:#475569;font-weight:600}dd{margin:0}' +
  '.note{color:#475569;font-size:.9rem}a{color:#1e3a8a}code{word-break:break-all;font-size:.8rem}' +
  '@media (prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}.card{background:#111827;border-color:#1f2937}.college,dt,.note{color:#cbd5e1}a{color:#93c5fd}}';

const TITLES: Record<string, string> = {
  PlacementOfferCredential: 'Verified placement offer',
  ReadinessMilestoneCredential: 'Placement readiness milestone',
  MentorCertificateCredential: 'Certificate of mentorship',
  MentorshipRecognitionCredential: 'Mentorship recognition',
};
const CLAIM_LABELS: Record<string, string> = {
  company: 'Company',
  role: 'Role',
  batch: 'Batch',
  milestone: 'Readiness reached',
  reachedOn: 'Reached on',
  academicYear: 'Academic year',
  sessions: 'Sessions mentored',
  mentees: 'Mentees',
  asks: 'Small favours done',
  events: 'Events hosted',
  award: 'Recognition',
  month: 'Month',
};
const STATUS: Record<VerifiedCredential['status'], string> = {
  valid: 'Valid: signed by the college and not revoked',
  revoked: 'Revoked by the college or the holder',
  key_compromised: 'The college withdrew the key that signed this. Ask the college to issue it again.',
  invalid: 'The signature does not check out',
};

function page(title: string, body: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    `<title>${esc(title)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    `<body><main>${body}</main></body>`,
    '</html>',
  ].join('\n');
}

export function verifyHtml(v: VerifiedCredential, jwtUrl: string, didUrl: string): string {
  const title = v.type ? (TITLES[v.type] ?? 'Credential') : 'Credential';
  const rows = Object.entries(v.claims)
    .map(([k, val]) => `<dt>${esc(CLAIM_LABELS[k] ?? k)}</dt><dd>${esc(String(val))}</dd>`)
    .join('');
  return page(
    `${title} · ${v.college.name}`,
    [
      '<div class="card">',
      `<div class="college">${esc(v.college.name)}</div>`,
      `<h1>${esc(title)}</h1>`,
      `<p class="status ${v.status === 'valid' ? 'valid' : 'bad'}" role="status">${esc(STATUS[v.status])}</p>`,
      v.status === 'revoked' && !v.name
        ? ''
        : `<dl><dt>Issued to</dt><dd>${esc(v.name ?? '')}</dd>${rows}<dt>Issued on</dt><dd>${esc((v.issuedAt ?? '').slice(0, 10))}</dd></dl>`,
      `<p class="note">Issuer: <code>${esc(v.issuer)}</code>. The signature is checked against the college’s published key (<a href="${esc(didUrl)}">did.json</a>).</p>`,
      v.jwt ? `<p class="note"><a href="${esc(jwtUrl)}">Download the signed credential (vc+jwt)</a></p>` : '',
      `<p class="note">Checked by ${esc(APP_NAME)}. It shows only what the college attested; no contact details.</p>`,
      '</div>',
    ].join(''),
  );
}

export function credentialNotFoundHtml(): string {
  return page(
    'Credential not found',
    '<div class="card"><h1>This credential is not available</h1><p>Check the link. A credential its holder removed is no longer shown.</p></div>',
  );
}
