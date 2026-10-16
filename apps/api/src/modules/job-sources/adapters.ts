import type { JobSourceKind } from '@campuslink/shared';
import { SafeFetchError, type safeFetch } from '../../lib/safe-fetch.js';
import { decodeEntities, plainText, snippet } from '../../lib/text.js';
import { fetchFeed, BOT_TOKEN } from '../content-sources/fetch.js';

/** One posting as a source describes it, before normalisation. */
export interface RawJob {
  externalId: string;
  title: string;
  company: string | null;
  location: string;
  remote: boolean | null;
  workplace: string | null;
  employment: string | null;
  applyUrl: string;
  description: string;
  postedAt: Date | null;
  salary: { min: number; max: number; currency: string; period: 'year' | 'month' } | null;
}

export interface SourceConfig {
  kind: JobSourceKind;
  board?: string | null;
  query?: string | null;
  where?: string | null;
  url?: string | null;
}

export type FetchResult =
  | { kind: 'ok'; jobs: RawJob[]; etag?: string | null; lastModified?: string | null }
  | { kind: 'not_modified' }
  | { kind: 'blocked'; message: string }
  | { kind: 'error'; message: string; retryAfterSec: number | null };

export interface AdapterContext {
  fetcher: typeof safeFetch;
  /** Adzuna credentials (deployment env); the adapter is unavailable without them. */
  adzuna?: { appId: string; appKey: string } | null;
  cache?: { etag?: string | null; lastModified?: string | null };
}

/** What a `JobSourceAdapter` implements (docs/job-sources.md). */
export interface JobSourceAdapter {
  kind: JobSourceKind;
  /** Display string for the admin list (board name, query or URL). */
  target(cfg: SourceConfig): string;
  /** The vendor's own attribution line, when its terms require one. */
  attribution: string | null;
  fetch(cfg: SourceConfig, ctx: AdapterContext): Promise<FetchResult>;
}

const UA = `${BOT_TOKEN}/1.0 (+public job-board APIs; links to the employer's page)`;
type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const date = (v: unknown): Date | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(typeof v === 'number' ? v : str(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
const https = (u: string): string | null => {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};
const text = (html: string, max = 1500) => snippet(plainText(html), max);

async function getJson(url: string, fetcher: typeof safeFetch): Promise<{ data: unknown } | FetchResult> {
  let res;
  try {
    res = await fetcher(url, {
      maxBytes: 8 * 1024 * 1024,
      timeoutMs: 20_000,
      headers: { 'user-agent': UA, accept: 'application/json' },
    });
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof SafeFetchError ? e.message : 'Fetch failed',
      retryAfterSec: null,
    };
  }
  if (res.status === 429 || res.status === 503) {
    const ra = Number(res.headers?.['retry-after']);
    return {
      kind: 'error',
      message: `The source asked us to slow down (${res.status})`,
      retryAfterSec: Number.isFinite(ra) ? Math.min(Math.max(ra, 300), 86_400) : 3600,
    };
  }
  if (res.status === 404)
    return { kind: 'error', message: 'Board not found (check the name)', retryAfterSec: null };
  if (res.status !== 200)
    return { kind: 'error', message: `The source returned ${res.status}`, retryAfterSec: null };
  try {
    return { data: JSON.parse(res.body.toString('utf8')) as unknown };
  } catch {
    return { kind: 'error', message: 'The source did not return JSON', retryAfterSec: null };
  }
}
const failed = (r: { data: unknown } | FetchResult): r is FetchResult => 'kind' in r;
const enc = encodeURIComponent;

/** Greenhouse Job Board API: GET /v1/boards/{board}/jobs?content=true (public, read-only). */
export const greenhouse: JobSourceAdapter = {
  kind: 'greenhouse',
  attribution: null,
  target: (c) => `boards.greenhouse.io/${c.board ?? ''}`,
  async fetch(c, ctx) {
    const r = await getJson(
      `https://boards-api.greenhouse.io/v1/boards/${enc(c.board ?? '')}/jobs?content=true`,
      ctx.fetcher,
    );
    if (failed(r)) return r;
    const jobs = arr(obj(r.data).jobs).flatMap((raw): RawJob[] => {
      const j = obj(raw);
      const apply = https(str(j.absolute_url));
      if (!apply || !str(j.title)) return [];
      return [
        {
          externalId: str(j.id),
          title: str(j.title),
          company: str(j.company_name) || null,
          location: str(obj(j.location).name),
          remote: null,
          workplace: null,
          employment: null,
          applyUrl: apply,
          // Greenhouse returns the description HTML entity-escaped.
          description: text(decodeEntities(str(j.content))),
          postedAt: date(j.first_published) ?? date(j.updated_at),
          salary: null,
        },
      ];
    });
    return { kind: 'ok', jobs };
  },
};

/** Lever Postings API: GET /v0/postings/{board}?mode=json (public, read-only). */
export const lever: JobSourceAdapter = {
  kind: 'lever',
  attribution: null,
  target: (c) => `jobs.lever.co/${c.board ?? ''}`,
  async fetch(c, ctx) {
    const r = await getJson(`https://api.lever.co/v0/postings/${enc(c.board ?? '')}?mode=json`, ctx.fetcher);
    if (failed(r)) return r;
    const jobs = arr(r.data).flatMap((raw): RawJob[] => {
      const j = obj(raw);
      const cat = obj(j.categories);
      const apply = https(str(j.hostedUrl)) ?? https(str(j.applyUrl));
      if (!apply || !str(j.text)) return [];
      const sal = obj(j.salaryRange);
      const min = num(sal.min);
      const max = num(sal.max);
      return [
        {
          externalId: str(j.id),
          title: str(j.text),
          company: null,
          location: str(cat.location) || arr(cat.allLocations).map(str).join(', '),
          remote: str(j.workplaceType) === 'remote' ? true : null,
          workplace: str(j.workplaceType) || null,
          employment: str(cat.commitment) || null,
          applyUrl: apply,
          description: snippet(str(j.descriptionPlain) || plainText(str(j.description)), 1500),
          postedAt: date(j.createdAt),
          salary:
            min !== null && max !== null && str(sal.currency)
              ? {
                  min,
                  max,
                  currency: str(sal.currency).toUpperCase(),
                  period: /month/i.test(str(sal.interval)) ? 'month' : 'year',
                }
              : null,
        },
      ];
    });
    return { kind: 'ok', jobs };
  },
};

/** Ashby Posting API: GET /posting-api/job-board/{board} (public job board). */
export const ashby: JobSourceAdapter = {
  kind: 'ashby',
  attribution: null,
  target: (c) => `jobs.ashbyhq.com/${c.board ?? ''}`,
  async fetch(c, ctx) {
    const r = await getJson(
      `https://api.ashbyhq.com/posting-api/job-board/${enc(c.board ?? '')}?includeCompensation=true`,
      ctx.fetcher,
    );
    if (failed(r)) return r;
    const jobs = arr(obj(r.data).jobs).flatMap((raw): RawJob[] => {
      const j = obj(raw);
      if (j.isListed === false) return [];
      const apply = https(str(j.jobUrl)) ?? https(str(j.applyUrl));
      if (!apply || !str(j.title)) return [];
      const secondary = arr(j.secondaryLocations).map((l) => str(obj(l).location));
      return [
        {
          externalId: str(j.id) || apply,
          title: str(j.title),
          company: null,
          location: [str(j.location), ...secondary].filter(Boolean).join(', '),
          remote: j.isRemote === true ? true : null,
          workplace: str(j.workplaceType) || null,
          employment: str(j.employmentType) || null,
          applyUrl: apply,
          description: snippet(str(j.descriptionPlain) || plainText(str(j.descriptionHtml)), 1500),
          postedAt: date(j.publishedAt),
          salary: null,
        },
      ];
    });
    return { kind: 'ok', jobs };
  },
};

/** SmartRecruiters Posting API: GET /v1/companies/{board}/postings (public list). */
export const smartrecruiters: JobSourceAdapter = {
  kind: 'smartrecruiters',
  attribution: null,
  target: (c) => `jobs.smartrecruiters.com/${c.board ?? ''}`,
  async fetch(c, ctx) {
    const board = c.board ?? '';
    const r = await getJson(
      `https://api.smartrecruiters.com/v1/companies/${enc(board)}/postings?limit=100`,
      ctx.fetcher,
    );
    if (failed(r)) return r;
    const jobs = arr(obj(r.data).content).flatMap((raw): RawJob[] => {
      const j = obj(raw);
      const id = str(j.id);
      if (!id || !str(j.name)) return [];
      const loc = obj(j.location);
      const place = [
        str(loc.city),
        str(loc.region),
        str(loc.country).toUpperCase() === 'IN' ? 'India' : str(loc.country),
      ]
        .filter(Boolean)
        .join(', ');
      const level = str(obj(j.experienceLevel).label);
      return [
        {
          externalId: id,
          title: str(j.name),
          company: str(obj(j.company).name) || null,
          location: place,
          remote: loc.remote === true ? true : null,
          workplace: null,
          employment: str(obj(j.typeOfEmployment).label) || null,
          applyUrl: `https://jobs.smartrecruiters.com/${enc(board)}/${enc(id)}`,
          description: [str(obj(j.function).label), level, str(obj(j.department).label)]
            .filter(Boolean)
            .join(' · '),
          postedAt: date(j.releasedDate),
          salary: null,
        },
      ];
    });
    return { kind: 'ok', jobs };
  },
};

/** Adzuna Search API (India). Needs the deployment's own app id and key; terms require attribution. */
export const adzuna: JobSourceAdapter = {
  kind: 'adzuna',
  attribution: 'Jobs by Adzuna',
  target: (c) => `adzuna: ${c.query ?? ''}${c.where ? ` in ${c.where}` : ''}`,
  async fetch(c, ctx) {
    if (!ctx.adzuna)
      return { kind: 'blocked', message: 'Adzuna is not configured (ADZUNA_APP_ID and ADZUNA_APP_KEY)' };
    const params = new URLSearchParams({
      app_id: ctx.adzuna.appId,
      app_key: ctx.adzuna.appKey,
      results_per_page: '50',
      what: c.query ?? '',
      max_days_old: '21',
      'content-type': 'application/json',
    });
    if (c.where) params.set('where', c.where);
    const r = await getJson(
      `https://api.adzuna.com/v1/api/jobs/in/search/1?${params.toString()}`,
      ctx.fetcher,
    );
    if (failed(r)) return r;
    const jobs = arr(obj(r.data).results).flatMap((raw): RawJob[] => {
      const j = obj(raw);
      const apply = https(str(j.redirect_url));
      if (!apply || !str(j.title)) return [];
      const min = num(j.salary_min);
      const max = num(j.salary_max);
      return [
        {
          externalId: str(j.id),
          title: plainText(str(j.title)),
          company: str(obj(j.company).display_name) || null,
          location: str(obj(j.location).display_name),
          remote: null,
          workplace: null,
          employment: str(j.contract_time) || null,
          applyUrl: apply,
          description: text(str(j.description), 600),
          postedAt: date(j.created),
          salary:
            min !== null && max !== null && j.salary_is_predicted !== '1'
              ? { min: Math.round(min), max: Math.round(max), currency: 'INR', period: 'year' }
              : null,
        },
      ];
    });
    return { kind: 'ok', jobs };
  },
};

/** RSS/Atom (government notices, company career feeds): the Phase 4 polite fetcher, robots.txt included. */
export const rssJobs: JobSourceAdapter = {
  kind: 'rss',
  attribution: null,
  target: (c) => c.url ?? '',
  async fetch(c, ctx) {
    const r = await fetchFeed(c.url ?? '', ctx.fetcher, ctx.cache ?? {});
    if (r.kind === 'not_modified') return { kind: 'not_modified' };
    if (r.kind === 'blocked') return r;
    if (r.kind === 'error') return r;
    const jobs = r.feed.items.flatMap((i): RawJob[] => {
      const apply = https(i.url);
      return apply
        ? [
            {
              externalId: apply,
              title: i.title,
              company: null,
              location: '',
              remote: null,
              workplace: null,
              employment: null,
              applyUrl: apply,
              description: i.snippet,
              postedAt: i.publishedAt,
              salary: null,
            },
          ]
        : [];
    });
    return { kind: 'ok', jobs, etag: r.etag, lastModified: r.lastModified };
  },
};

export const ADAPTERS: Record<JobSourceKind, JobSourceAdapter> = {
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  adzuna,
  rss: rssJobs,
};
