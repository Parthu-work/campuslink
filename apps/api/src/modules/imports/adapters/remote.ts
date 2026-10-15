import type { safeFetch } from '../../../lib/safe-fetch.js';
import { SafeFetchError, type SafeFetchOptions } from '../../../lib/safe-fetch.js';
import { csvAdapter } from './csv.js';
import {
  cell,
  MAX_ROWS,
  normaliseTable,
  SourceError,
  type DataSourceAdapter,
  type SourceRows,
} from './types.js';

export type Fetcher = typeof safeFetch;

/**
 * Google Sheets shared as "anyone with the link": uses Google's documented CSV export endpoint.
 * Accepts the normal sharing URL and keeps the selected tab (gid).
 */
export function googleSheetCsvUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SourceError('That is not a valid link');
  }
  const m = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})/.exec(u.pathname);
  if (u.hostname !== 'docs.google.com' || !m)
    throw new SourceError('Paste the Google Sheets link (docs.google.com/spreadsheets/d/…)');
  const gid = /(?:[#&?]gid=)(\d{1,15})/.exec(u.hash + u.search)?.[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}

export function googleSheetAdapter(
  fetcher: Fetcher,
  extra: SafeFetchOptions = {},
): DataSourceAdapter<string> {
  return {
    kind: 'gsheet',
    async read(url: string): Promise<SourceRows> {
      const res = await fetcher(googleSheetCsvUrl(url), {
        allowHosts: ['docs.google.com', '.googleusercontent.com'],
        ...extra,
      }).catch((e: unknown) => {
        throw new SourceError(e instanceof SafeFetchError ? e.message : 'Could not reach Google Sheets');
      });
      if (res.status === 401 || res.status === 403 || /text\/html/.test(res.contentType)) {
        throw new SourceError(
          'Google Sheets refused access. Share the sheet as “Anyone with the link can view” and try again.',
        );
      }
      if (res.status !== 200) throw new SourceError(`Google Sheets returned ${res.status}`);
      return csvAdapter.read(res.body);
    },
  };
}

/** Generic REST/JSON adapter (ERP/LMS exports). The bearer token is used once and never stored. */
export function restJsonAdapter(
  fetcher: Fetcher,
  extra: SafeFetchOptions = {},
): DataSourceAdapter<{ url: string; recordsPath?: string | undefined; bearerToken?: string | undefined }> {
  return {
    kind: 'rest',
    async read({ url, recordsPath, bearerToken }): Promise<SourceRows> {
      const res = await fetcher(url, {
        ...(bearerToken
          ? { headers: { authorization: `Bearer ${bearerToken}`, accept: 'application/json' } }
          : { headers: { accept: 'application/json' } }),
        ...extra,
      }).catch((e: unknown) => {
        throw new SourceError(e instanceof SafeFetchError ? e.message : 'Could not reach that URL');
      });
      if (res.status !== 200) throw new SourceError(`The source returned ${res.status}`);
      let json: unknown;
      try {
        json = JSON.parse(res.body.toString('utf8'));
      } catch {
        throw new SourceError('The source did not return JSON');
      }
      let node: unknown = json;
      for (const k of recordsPath?.split('.') ?? []) node = (node as Record<string, unknown> | null)?.[k];
      if (!Array.isArray(node)) throw new SourceError('Could not find a list of records at that path');
      if (node.length > MAX_ROWS) throw new SourceError(`Too many rows (max ${MAX_ROWS})`);
      const objects = node.filter(
        (r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r),
      );
      const headers = [
        ...new Set(
          objects.flatMap((o) => Object.keys(o).filter((k) => typeof o[k] !== 'object' || o[k] === null)),
        ),
      ].slice(0, 50);
      return normaliseTable(
        headers,
        objects.map((o) => headers.map((h) => cell(o[h]))),
      );
    },
  };
}
