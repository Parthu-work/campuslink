import { fileTypeFromBuffer } from 'file-type';
import { csvAdapter } from '../imports/adapters/csv.js';
import { xlsxAdapter } from '../imports/adapters/xlsx.js';
import { SourceError } from '../imports/adapters/types.js';
import { badRequest } from '../../lib/errors.js';

/** Headers a college sheet uses for the roll number (hall ticket, PIN and so on). */
export const ROLL_HEADERS = [
  'roll',
  'roll no',
  'roll number',
  'rollno',
  'roll_no',
  'hall ticket',
  'htno',
  'reg no',
  'pin',
];

/** Lower case, separators as spaces, single spaces: how headers are compared. */
export const normHeader = (h: string) => h.toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();

/** A CSV or Excel upload as headers and rows (B7 round results, B8 outcomes). */
export async function readSheet(file: Express.Multer.File | undefined) {
  if (!file) throw badRequest('Choose a CSV or Excel file');
  const type = await fileTypeFromBuffer(file.buffer);
  try {
    return type?.ext === 'xlsx' ? await xlsxAdapter.read(file.buffer) : await csvAdapter.read(file.buffer);
  } catch (e) {
    if (e instanceof SourceError) throw badRequest(e.message);
    throw e;
  }
}

/** The first header that matches one of these names (compared normalised). */
export const findHeader = (headers: string[], names: readonly string[]) =>
  headers.find((h) => names.includes(normHeader(h)));
