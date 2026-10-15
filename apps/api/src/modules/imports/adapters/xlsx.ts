import { readSheet } from 'read-excel-file/node';
import { assertSafeZip } from '../../../lib/zip-guard.js';
import { normaliseTable, SourceError, type DataSourceAdapter, type SourceRows } from './types.js';

export const xlsxAdapter: DataSourceAdapter<Buffer> = {
  kind: 'xlsx',
  async read(buf: Buffer): Promise<SourceRows> {
    try {
      assertSafeZip(buf);
    } catch (e) {
      throw new SourceError((e as Error).message);
    }
    let rows: unknown[][];
    try {
      rows = (await readSheet(buf)) as unknown[][]; // first sheet only
    } catch {
      throw new SourceError('Could not read this Excel file. Save it as .xlsx and try again.');
    }
    const [header, ...data] = rows;
    if (!header) throw new SourceError('The first sheet is empty');
    return normaliseTable(header, data);
  },
};
