import { saveBlob } from './api';

/**
 * One CSV cell: quoted, quotes doubled, and a leading = + - @ (or tab/CR) neutralised so a
 * spreadsheet never runs a name as a formula.
 */
export const csvCell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;

/** Builds a CSV in the browser and hands it to the member as a download (UTF-8 with BOM for Excel). */
export function downloadCsv(name: string, header: string[], rows: string[][]) {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  saveBlob(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }), name);
}
