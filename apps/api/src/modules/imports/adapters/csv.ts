import { parse } from 'csv-parse/sync';
import { normaliseTable, SourceError, type DataSourceAdapter, type SourceRows } from './types.js';

export const csvAdapter: DataSourceAdapter<Buffer> = {
  kind: 'csv',
  async read(buf: Buffer): Promise<SourceRows> {
    if (buf.includes(0)) throw new SourceError('This does not look like a CSV text file');
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    let records: string[][];
    try {
      records = parse(text, {
        bom: true,
        delimiter: [',', ';', '\t'],
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
        max_record_size: 64_000,
      });
    } catch {
      throw new SourceError('Could not read this CSV. Check that it is comma-separated and saved as UTF-8.');
    }
    const [header, ...rows] = records;
    if (!header) throw new SourceError('The file is empty');
    return normaliseTable(header, rows);
  },
};
