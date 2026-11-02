import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { APP_NAME, GST_STATES, formatRupees, type GstSplit } from '@campuslink/shared';

/**
 * The invoice as a PDF (build B10), drawn with pdf-lib. Noto Sans (SIL Open Font Licence,
 * `assets/fonts/OFL.txt`) is embedded, subset, because the standard PDF fonts have no ₹ sign.
 */
export interface InvoicePdfInput {
  number: string;
  issuedOn: string;
  dueOn: string;
  periodStart: string;
  periodEnd: string;
  /** Registered sellers issue a tax invoice; an unregistered one, a plain invoice. */
  registered: boolean;
  seller: { name: string; address: string; gstin: string | null; stateCode: string | null };
  buyer: { name: string; address: string; gstin: string | null; stateCode: string | null };
  lines: { description: string; quantity: number; unitPaise: number; amountPaise: number }[];
  sacCode: string;
  taxablePaise: number;
  gst: GstSplit;
  totalPaise: number;
  totalInWords: string;
  notes: string | null;
  bankDetails: string | null;
}

let fonts: Promise<[Buffer, Buffer]> | null = null;
const loadFonts = () =>
  (fonts ??= Promise.all([
    readFile(new URL('../../../assets/fonts/NotoSans-Regular.ttf', import.meta.url)),
    readFile(new URL('../../../assets/fonts/NotoSans-Bold.ttf', import.meta.url)),
  ]));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `2026-10-30` → `30 Oct 2026`. */
export const longDate = (d: string) =>
  `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const stateLabel = (code: string | null) =>
  code ? `${GST_STATES[code as keyof typeof GST_STATES] ?? code} (${code})` : '—';

const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.38, 0.38, 0.42);
const RULE = rgb(0.82, 0.82, 0.86);
const A4: [number, number] = [595.28, 841.89];
const M = 48;

/** Splits text into lines that fit `width` (a word longer than a line is kept whole). */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.trim().split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > width) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}

export async function renderInvoicePdf(inv: InvoicePdfInput): Promise<Buffer> {
  const [regularBytes, boldBytes] = await loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  doc.setTitle(`Invoice ${inv.number}`);
  doc.setCreator(APP_NAME);
  doc.setProducer(APP_NAME);
  doc.setCreationDate(new Date(`${inv.issuedOn}T00:00:00Z`));
  doc.setModificationDate(new Date(`${inv.issuedOn}T00:00:00Z`));

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const width = A4[0] - 2 * M;
  const text = (s: string, x: number, size = 9.5, font = regular, color = INK) =>
    page.drawText(s, { x, y, size, font, color });
  const right = (s: string, xRight: number, size = 9.5, font = regular, color = INK) =>
    page.drawText(s, { x: xRight - font.widthOfTextAtSize(s, size), y, size, font, color });
  const rule = () => {
    page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.6, color: RULE });
  };
  const ensure = (needed: number) => {
    if (y - needed > M + 40) return;
    page = doc.addPage(A4);
    y = A4[1] - M;
  };

  // Title and number.
  text(inv.registered ? 'Tax Invoice' : 'Invoice', M, 20, bold);
  right(inv.number, M + width, 12, bold);
  y -= 30;
  rule();
  y -= 18;

  // Seller (left) and invoice details (right).
  const colW = width / 2 - 12;
  const top = y;
  text('From', M, 8.5, bold, MUTED);
  y -= 14;
  text(inv.seller.name, M, 10.5, bold);
  y -= 13;
  for (const l of wrap(inv.seller.address, regular, 9, colW)) {
    text(l, M, 9);
    y -= 12;
  }
  if (inv.seller.gstin) {
    text(`GSTIN ${inv.seller.gstin}`, M, 9);
    y -= 12;
  }
  text(`State ${stateLabel(inv.seller.stateCode)}`, M, 9, regular, MUTED);
  const leftBottom = y - 12;

  y = top;
  const kx = M + width / 2 + 12;
  const details: [string, string][] = [
    ['Invoice date', longDate(inv.issuedOn)],
    ['Due date', longDate(inv.dueOn)],
    ['Period', `${longDate(inv.periodStart)} to ${longDate(inv.periodEnd)}`],
    ['Place of supply', stateLabel(inv.buyer.stateCode)],
  ];
  for (const [k, v] of details) {
    text(k, kx, 9, regular, MUTED);
    right(v, M + width, 9, bold);
    y -= 14;
  }
  y = Math.min(y, leftBottom) - 8;

  // Buyer.
  text('Bill to', M, 8.5, bold, MUTED);
  y -= 14;
  text(inv.buyer.name, M, 10.5, bold);
  y -= 13;
  for (const l of wrap(inv.buyer.address, regular, 9, width * 0.6)) {
    text(l, M, 9);
    y -= 12;
  }
  if (inv.buyer.gstin) {
    text(`GSTIN ${inv.buyer.gstin}`, M, 9);
    y -= 12;
  }
  y -= 14;

  // Lines.
  const cols = { n: M, desc: M + 22, sac: M + width - 250, qty: M + width - 170, rate: M + width - 90 };
  const headerRow = () => {
    page.drawRectangle({ x: M, y: y - 5, width, height: 18, color: rgb(0.95, 0.95, 0.97) });
    text('#', cols.n + 4, 8.5, bold, MUTED);
    text('Description', cols.desc, 8.5, bold, MUTED);
    text('SAC', cols.sac, 8.5, bold, MUTED);
    right('Qty', cols.qty + 40, 8.5, bold, MUTED);
    right('Rate', cols.rate + 50, 8.5, bold, MUTED);
    right('Amount', M + width, 8.5, bold, MUTED);
    y -= 22;
  };
  headerRow();
  inv.lines.forEach((l, i) => {
    const desc = wrap(l.description, regular, 9, cols.sac - cols.desc - 10);
    ensure(desc.length * 12 + 10);
    text(String(i + 1), cols.n + 4, 9);
    text(inv.sacCode || '—', cols.sac, 9);
    right(l.quantity.toLocaleString('en-IN'), cols.qty + 40, 9);
    right(formatRupees(l.unitPaise), cols.rate + 50, 9);
    right(formatRupees(l.amountPaise), M + width, 9);
    for (const d of desc) {
      text(d, cols.desc, 9);
      y -= 12;
    }
    y -= 6;
    rule();
    y -= 14;
  });

  // Totals.
  ensure(110);
  const tx = M + width - 220;
  const total = (k: string, v: string, strong = false) => {
    text(k, tx, strong ? 10.5 : 9.5, strong ? bold : regular, strong ? INK : MUTED);
    right(v, M + width, strong ? 10.5 : 9.5, strong ? bold : regular);
    y -= strong ? 18 : 14;
  };
  total('Taxable value', formatRupees(inv.taxablePaise));
  const half = inv.gst.ratePercent / 2;
  if (inv.gst.kind === 'intra') {
    total(`CGST ${half}%`, formatRupees(inv.gst.cgstPaise));
    total(`${inv.gst.stateTaxName} ${half}%`, formatRupees(inv.gst.sgstPaise));
  } else if (inv.gst.kind === 'inter') total(`IGST ${inv.gst.ratePercent}%`, formatRupees(inv.gst.igstPaise));
  else total('GST', 'Not charged');
  y -= 2;
  page.drawLine({
    start: { x: tx, y: y + 10 },
    end: { x: M + width, y: y + 10 },
    thickness: 0.6,
    color: RULE,
  });
  total('Total', formatRupees(inv.totalPaise), true);
  for (const l of wrap(inv.totalInWords, regular, 9, width)) {
    text(l, M, 9, regular, MUTED);
    y -= 12;
  }
  y -= 10;

  // Payment and notes.
  const footer: string[] = [];
  if (inv.bankDetails)
    footer.push(`Pay by bank transfer: ${inv.bankDetails}. Quote ${inv.number} as the reference.`);
  if (!inv.registered) footer.push('The supplier is not registered for GST; no tax is charged.');
  if (inv.notes) footer.push(inv.notes);
  footer.push('This is a computer-generated invoice.');
  for (const f of footer) {
    const ls = wrap(f, regular, 8.5, width);
    ensure(ls.length * 11 + 6);
    for (const l of ls) {
      text(l, M, 8.5, regular, MUTED);
      y -= 11;
    }
    y -= 4;
  }
  return Buffer.from(await doc.save());
}
