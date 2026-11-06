import sharp from 'sharp';
import type { CollegeOutcomesView, PublicPageContent } from '@campuslink/shared';

/**
 * Server-rendered public pages (prompt 2, G8): plain HTML with Open Graph tags, and a 1200×630
 * share image. Both are built from the page's opt-in fields only (PublicPageContent): never an
 * email, a phone number, a CTC or anything the member did not choose to show.
 */

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** Breaks text into lines of at most `max` characters (by words) for the SVG, at most `lines` lines. */
function wrap(text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((line + ' ' + w).trim().length > max) {
      if (line) out.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    kept[lines - 1] = `${(kept[lines - 1] ?? '').slice(0, max - 1)}…`;
    return kept;
  }
  return out;
}

/** The share image's SVG: the college, the headline, the detail and the name (opt-in fields only). */
export function shareSvg(c: { college: string; headline: string; detail: string; name: string }): string {
  const head = wrap(c.headline, 28, 2);
  const detail = wrap(c.detail, 48, 2);
  const text = (x: number, y: number, size: number, weight: number, fill: string, s: string) =>
    `<text x="${x}" y="${y}" font-family="Noto Sans, DejaVu Sans, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(s)}</text>`;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#0f766e"/></linearGradient></defs>',
    '<rect width="1200" height="630" fill="url(#g)"/>',
    text(80, 110, 34, 600, '#c7d2fe', c.college),
    ...head.map((l, i) => text(80, 240 + i * 82, 72, 700, '#ffffff', l)),
    ...detail.map((l, i) => text(80, 240 + head.length * 82 + 30 + i * 46, 36, 400, '#e0f2fe', l)),
    text(80, 560, 40, 600, '#ffffff', c.name),
    text(830, 560, 30, 500, '#c7d2fe', 'CampusLink'),
    '</svg>',
  ].join('');
}

export const sharePng = (svg: string) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

const PAGE_STYLE =
  'body{margin:0;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans",sans-serif;background:#f8fafc;color:#0f172a}' +
  'main{max-width:640px;margin:0 auto;padding:40px 16px}' +
  '.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px}' +
  'h1{font-size:1.75rem;line-height:1.25;margin:.25rem 0 .5rem}' +
  '.college{color:#475569;font-weight:600}.detail{color:#334155;font-size:1.1rem}' +
  'img{width:100%;height:auto;border-radius:12px;margin-top:16px}' +
  'a.join{display:inline-flex;align-items:center;min-height:44px;margin-top:20px;padding:0 20px;border-radius:999px;background:#1e3a8a;color:#fff;font-weight:600;text-decoration:none}' +
  'table{width:100%;border-collapse:collapse;margin-top:8px}td,th{padding:8px 4px;border-bottom:1px solid #e2e8f0;text-align:left}' +
  'th{color:#475569;font-weight:600}h2{font-size:1.15rem;margin:24px 0 4px}.note{color:#64748b;font-size:.9rem}' +
  '@media (prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}.card{background:#111827;border-color:#1f2937}.college,.detail,th,.note{color:#cbd5e1}td,th{border-color:#1f2937}}';

function shell(o: {
  title: string;
  description: string;
  url: string;
  image: string;
  indexable: boolean;
  body: string;
  lang?: string;
}): string {
  return [
    '<!doctype html>',
    `<html lang="${o.lang ?? 'en'}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(o.title)}</title>`,
    `<meta name="description" content="${esc(o.description)}">`,
    `<meta name="robots" content="${o.indexable ? 'index, follow' : 'noindex, nofollow'}">`,
    `<link rel="canonical" href="${esc(o.url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(o.title)}">`,
    `<meta property="og:description" content="${esc(o.description)}">`,
    `<meta property="og:url" content="${esc(o.url)}">`,
    `<meta property="og:image" content="${esc(o.image)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<style>${PAGE_STYLE}</style>`,
    '</head>',
    `<body><main>${o.body}</main></body>`,
    '</html>',
  ].join('\n');
}

/** A member's public page (the image repeats it; the link invites the reader to the college's CampusLink). */
export function pageHtml(
  c: PublicPageContent,
  o: { url: string; image: string; joinUrl: string; indexable: boolean },
): string {
  const title = `${c.name}: ${c.headline}`;
  return shell({
    title,
    description: `${c.headline}. ${c.detail} · ${c.college}`.slice(0, 280),
    url: o.url,
    image: o.image,
    indexable: o.indexable,
    body: [
      '<div class="card">',
      `<div class="college">${esc(c.college)}</div>`,
      `<h1>${esc(c.headline)}</h1>`,
      c.detail ? `<p class="detail">${esc(c.detail)}</p>` : '',
      `<p><strong>${esc(c.name)}</strong>${c.year ? ` · ${esc(String(c.year))}` : ''}</p>`,
      `<img src="${esc(o.image)}" alt="${esc(title)}" width="1200" height="630">`,
      `<a class="join" href="${esc(o.joinUrl)}">Join ${esc(c.college)} on CampusLink</a>`,
      '</div>',
    ].join(''),
  });
}

/** The college outcomes page: aggregates only, small groups shown as "<5". */
export function outcomesHtml(
  v: CollegeOutcomesView,
  o: { url: string; image: string; joinUrl: string },
): string {
  const rows = (cells: string[][]) =>
    cells.map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('');
  return shell({
    title: `${v.college}: placement outcomes`,
    description: `Placements, recruiters and mentoring at ${v.college}, from the college's own verified records.`,
    url: o.url,
    image: o.image,
    indexable: true,
    body: [
      '<div class="card">',
      `<div class="college">${esc(v.college)}</div>`,
      '<h1>Placement outcomes</h1>',
      '<h2>By graduating year</h2>',
      `<table><thead><tr><th>Year</th><th>Placed</th><th>Placement %</th><th>Median offer band</th></tr></thead><tbody>${rows(
        v.years.map((y) => [
          String(y.gradYear),
          String(y.placed),
          y.placementPct === null ? '–' : `${y.placementPct}%`,
          y.medianBand ?? '–',
        ]),
      )}</tbody></table>`,
      v.recruiters.length
        ? `<h2>Top recruiters</h2><table><thead><tr><th>Company</th><th>Offers</th></tr></thead><tbody>${rows(v.recruiters.map((r) => [r.company, String(r.offers)]))}</tbody></table>`
        : '',
      v.alumniAt.length
        ? `<h2>Where alumni work</h2><table><thead><tr><th>Company</th><th>Alumni</th></tr></thead><tbody>${rows(v.alumniAt.map((r) => [r.company, String(r.alumni)]))}</tbody></table>`
        : '',
      `<h2>Mentoring</h2><p>${esc(String(v.mentoringHours))} hours of mentoring by alumni.</p>`,
      `<p class="note">From the college's verified records. Groups of fewer than five are shown as "&lt;5". Updated ${esc(v.updatedAt.slice(0, 10))}.</p>`,
      `<a class="join" href="${esc(o.joinUrl)}">Join ${esc(v.college)} on CampusLink</a>`,
      '</div>',
    ].join(''),
  });
}

export function notFoundHtml(): string {
  return shell({
    title: 'Page not found',
    description: 'This page is not available.',
    url: '',
    image: '',
    indexable: false,
    body: '<div class="card"><h1>This page is not available</h1><p>It may have been taken down by its owner.</p></div>',
  });
}
