import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { APP_NAME, type PledgePurpose } from '@campuslink/shared';

/**
 * The alumni PDFs (prompt 2, G6), rendered in the worker with pdf-lib and the self-hosted Noto Sans:
 * a mentorship certificate for an academic year (with its public verification link and a QR code
 * to it) and the acknowledgement of a contribution the college received. Text is English, as the
 * college's other formal documents (reports, invoices) are; the screens around them are translated.
 */
let fonts: Promise<[Buffer, Buffer]> | null = null;
const loadFonts = () =>
  (fonts ??= Promise.all([
    readFile(new URL('../../../assets/fonts/NotoSans-Regular.ttf', import.meta.url)),
    readFile(new URL('../../../assets/fonts/NotoSans-Bold.ttf', import.meta.url)),
  ]));

const INK = rgb(0.08, 0.08, 0.1);
const MUTED = rgb(0.35, 0.35, 0.4);
const RULE = rgb(0.78, 0.78, 0.82);
const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
const A4: [number, number] = [595.28, 841.89];

function centred(page: PDFPage, text: string, font: PDFFont, size: number, y: number, color = INK) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (page.getWidth() - w) / 2, y, size, font, color });
}

async function setup(size: [number, number]) {
  const [regularBytes, boldBytes] = await loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  const page = doc.addPage(size);
  return { doc, page, regular, bold };
}

export interface CertificateInput {
  college: string;
  name: string;
  academicYear: string;
  sessions: number;
  mentees: number;
  asks: number;
  events: number;
  code: string;
  verifyUrl: string;
  issuedOn: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function renderCertificatePdf(c: CertificateInput): Promise<Buffer> {
  const { doc, page, regular, bold } = await setup(A4_LANDSCAPE);
  const W = page.getWidth();
  const H = page.getHeight();
  page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: RULE, borderWidth: 2 });
  centred(page, c.college, bold, 18, H - 90, MUTED);
  centred(page, 'Certificate of Mentorship', bold, 32, H - 150);
  centred(page, 'This certifies that', regular, 14, H - 200, MUTED);
  centred(page, c.name, bold, 28, H - 245);
  centred(
    page,
    `mentored students of ${c.college} in the academic year ${c.academicYear}:`,
    regular,
    14,
    H - 285,
    MUTED,
  );
  const parts = [
    c.sessions ? plural(c.sessions, 'mentoring session', 'mentoring sessions') : '',
    c.mentees ? plural(c.mentees, 'student mentored', 'students mentored') : '',
    c.asks ? plural(c.asks, 'quick favour', 'quick favours') : '',
    c.events ? plural(c.events, 'event hosted', 'events hosted') : '',
  ].filter(Boolean);
  centred(page, parts.join(' · '), bold, 15, H - 320);
  centred(page, `Issued on ${c.issuedOn} by ${c.college} through ${APP_NAME}.`, regular, 11, 120, MUTED);
  centred(page, `Verify at ${c.verifyUrl}`, regular, 10, 100, MUTED);
  centred(page, `Verification code ${c.code}`, regular, 10, 84, MUTED);
  const qr = await QRCode.toBuffer(c.verifyUrl, { type: 'png', margin: 1, width: 240 });
  const img = await doc.embedPng(qr);
  page.drawImage(img, { x: W - 140, y: 48, width: 92, height: 92 });
  doc.setTitle(`Certificate of Mentorship ${c.academicYear}`);
  doc.setProducer(APP_NAME);
  doc.setCreator(APP_NAME);
  return Buffer.from(await doc.save());
}

export interface AcknowledgementInput {
  college: string;
  name: string;
  fund: string;
  purpose: PledgePurpose;
  amountPaise: number;
  receivedOn: string;
  reference: string;
  receiptNo: string;
  /** Only when the college is registered to issue tax receipts (its setting). */
  tax: { registration: string } | null;
  signatory: string;
}

const PURPOSE: Record<PledgePurpose, string> = {
  scholarship: 'Scholarships',
  lab: 'Laboratories',
  event: 'Events',
  general: 'General fund',
};
/** ₹ with Indian digit grouping, from whole paise. */
export const rupees = (paise: number) =>
  `INR ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function renderAcknowledgementPdf(a: AcknowledgementInput): Promise<Buffer> {
  const { doc, page, regular, bold } = await setup(A4);
  const H = page.getHeight();
  const x = 64;
  let y = H - 90;
  const line = (label: string, value: string) => {
    page.drawText(label, { x, y, size: 11, font: regular, color: MUTED });
    page.drawText(value, { x: x + 170, y, size: 11, font: bold, color: INK });
    y -= 24;
  };
  page.drawText(a.college, { x, y, size: 18, font: bold, color: INK });
  y -= 40;
  page.drawText(a.tax ? 'Receipt for donation' : 'Acknowledgement of contribution', {
    x,
    y,
    size: 22,
    font: bold,
    color: INK,
  });
  y -= 44;
  line('Number', a.receiptNo);
  line('Received from', a.name);
  line('Amount', rupees(a.amountPaise));
  line('Received on', a.receivedOn);
  line('Towards', `${a.fund} (${PURPOSE[a.purpose]})`);
  if (a.reference) line('Payment reference', a.reference);
  if (a.tax) line('Registration', a.tax.registration);
  y -= 16;
  page.drawLine({ start: { x, y }, end: { x: page.getWidth() - x, y }, thickness: 1, color: RULE });
  y -= 28;
  const note = a.tax
    ? `${a.college} received this donation directly. This receipt is issued under the registration above.`
    : `${a.college} received this contribution directly. This is an acknowledgement, not a tax receipt.`;
  page.drawText(note, {
    x,
    y,
    size: 10,
    font: regular,
    color: MUTED,
    maxWidth: page.getWidth() - 2 * x,
    lineHeight: 14,
  });
  y -= 60;
  if (a.signatory)
    page.drawText(`For ${a.college}: ${a.signatory}`, { x, y, size: 11, font: regular, color: INK });
  page.drawText(`Generated by ${APP_NAME}. Money is never paid to ${APP_NAME}.`, {
    x,
    y: 60,
    size: 9,
    font: regular,
    color: MUTED,
  });
  doc.setTitle(`${a.tax ? 'Receipt' : 'Acknowledgement'} ${a.receiptNo}`);
  doc.setProducer(APP_NAME);
  doc.setCreator(APP_NAME);
  return Buffer.from(await doc.save());
}
