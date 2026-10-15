/**
 * DataSourceAdapter: turns a college's source (spreadsheet, Google Sheet, ERP/LMS API) into flat rows.
 * To add a specific ERP, implement this interface (see docs/data-sources.md) and register it.
 */
export interface SourceRows {
  headers: string[];
  rows: Record<string, string>[];
}
export interface DataSourceAdapter<Input> {
  readonly kind: 'csv' | 'xlsx' | 'gsheet' | 'rest';
  read(input: Input): Promise<SourceRows>;
}

export const MAX_ROWS = 20_000;
const MAX_CELL = 500;

export class SourceError extends Error {}

/** Headers trimmed and de-duplicated; cells stringified, trimmed and capped. */
export function normaliseTable(headerRow: unknown[], dataRows: unknown[][]): SourceRows {
  const seen = new Map<string, number>();
  const headers = headerRow.map((h, i) => {
    const base =
      String(h ?? '')
        .trim()
        .slice(0, 100) || `Column ${i + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base} (${n + 1})` : base;
  });
  if (!headers.length) throw new SourceError('The file has no header row');
  if (dataRows.length > MAX_ROWS)
    throw new SourceError(`Too many rows (max ${MAX_ROWS.toLocaleString('en-IN')})`);
  const rows = dataRows
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, cell(r[i])])))
    .filter((r) => Object.values(r).some((v) => v !== ''));
  return { headers, rows };
}

export function cell(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim().slice(0, MAX_CELL);
}
