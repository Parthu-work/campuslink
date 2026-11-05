import { inflateRawSync } from 'node:zlib';
import { parse } from 'csv-parse/sync';
import { LINKEDIN_FILES, type LinkedinPreview } from '@campuslink/shared';
import { assertSafeZip } from '../../lib/zip-guard.js';

/**
 * LinkedIn import (prompt 2, G6): the member's own data export (the ZIP LinkedIn emails them, or
 * one of its CSV files), read in memory and never stored. No scraping, no LinkedIn API or sign-in.
 * The ZIP passes the zip-bomb guard before anything is inflated, only the three files we use are
 * read, each inflated with a hard output cap, and encrypted entries are refused.
 */

const FILE_CAP = 2 * 1024 * 1024;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export class LinkedinFileError extends Error {}

/** The files we read from a ZIP, by name (folders inside the archive are ignored). */
export function readZipEntries(buf: Buffer, wanted: readonly string[]): Map<string, Buffer> {
  try {
    assertSafeZip(buf, { maxTotal: 50 * 1024 * 1024, maxRatio: 100, maxEntries: 500 });
  } catch (e) {
    throw new LinkedinFileError(
      e instanceof Error ? e.message.replace(/Spreadsheet/g, 'Archive') : 'Not a ZIP',
    );
  }
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < entries; n++) {
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    const base = name.split('/').pop() ?? '';
    if (!wanted.includes(base) || out.has(base)) continue;
    if (flags & 1) throw new LinkedinFileError('The archive is password-protected');
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50)
      throw new LinkedinFileError('The archive is damaged');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    if (method === 0) out.set(base, Buffer.from(data.subarray(0, FILE_CAP)));
    else if (method === 8) {
      try {
        out.set(base, inflateRawSync(data, { maxOutputLength: FILE_CAP }));
      } catch {
        throw new LinkedinFileError(`${base} is too large or damaged`);
      }
    } else throw new LinkedinFileError('The archive uses a compression we do not read');
  }
  return out;
}

/** CSV rows as objects, from the first line that has the expected column (exports may start with notes). */
function rows(text: string, mustHave: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const at = lines.findIndex((l) => l.split(',').some((c) => c.replace(/"/g, '').trim() === mustHave));
  if (at < 0) return [];
  return parse(lines.slice(at).join('\n'), {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    to: 500,
  }) as Record<string, string>[];
}

/** "Jan 2020" → "2020-01"; "2020" stays; anything else is dropped. */
export function linkedinDate(s: string | undefined): string | null {
  const v = (s ?? '').trim().toLowerCase();
  const m = /^([a-z]{3})[a-z]* (\d{4})$/.exec(v);
  if (m) {
    const i = MONTHS.indexOf(m[1] ?? '');
    return i >= 0 ? `${m[2]}-${String(i + 1).padStart(2, '0')}` : null;
  }
  return /^\d{4}$/.test(v) ? v : null;
}

const clip = (s: string | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Positions, education and skills from LinkedIn's export files (a ZIP or one CSV). */
export function parseLinkedin(upload: Buffer, existingSkills: string[]): LinkedinPreview {
  const files = new Map<string, Buffer>();
  if (upload.subarray(0, 4).toString('latin1') === 'PK\u0003\u0004') {
    for (const [k, v] of readZipEntries(upload, LINKEDIN_FILES)) files.set(k, v);
  } else {
    // One CSV: tell which by its header.
    const text = upload.toString('utf8');
    if (text.includes('\u0000'))
      throw new LinkedinFileError('Upload the ZIP LinkedIn sent you, or one of its CSV files');
    if (/Company Name/.test(text)) files.set('Positions.csv', upload);
    else if (/School Name/.test(text)) files.set('Education.csv', upload);
    else if (/^\uFEFF?"?Name"?\s*$/m.test(text)) files.set('Skills.csv', upload);
  }
  if (!files.size)
    throw new LinkedinFileError('No positions, education or skills found. Upload the ZIP LinkedIn sent you.');
  const text = (k: string) => files.get(k)?.toString('utf8') ?? '';
  const positions = rows(text('Positions.csv'), 'Company Name')
    .map((r) => ({
      company: clip(r['Company Name'], 100),
      title: clip(r.Title, 100),
      from: linkedinDate(r['Started On']),
      to: linkedinDate(r['Finished On']),
      current: !clip(r['Finished On'], 20),
    }))
    .filter((p) => p.company || p.title)
    .slice(0, 50);
  const education = rows(text('Education.csv'), 'School Name')
    .map((r) => ({
      school: clip(r['School Name'], 120),
      degree: clip(r['Degree Name'], 100),
      from: linkedinDate(r['Start Date']),
      to: linkedinDate(r['End Date']),
    }))
    .filter((e) => e.school)
    .slice(0, 20);
  const seen = new Set<string>();
  const skills = rows(text('Skills.csv'), 'Name')
    .map((r) => clip(r.Name, 50))
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
    .slice(0, 100);
  return { positions, education, skills, existingSkills, read: [...files.keys()] };
}
