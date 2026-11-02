import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { APP_NAME, type ResumeContent, type ResumeTemplate } from '@campuslink/shared';

/**
 * The résumé as a PDF (prompt 2, G2): one column, real text drawn with an embedded font (selectable
 * and parseable), no tables, columns or images: the shape applicant tracking systems read reliably.
 * Noto Sans (SIL Open Font Licence, `assets/fonts`) covers the Latin text résumés are written in.
 */
let fonts: Promise<[Buffer, Buffer]> | null = null;
const loadFonts = () =>
  (fonts ??= Promise.all([
    readFile(new URL('../../../assets/fonts/NotoSans-Regular.ttf', import.meta.url)),
    readFile(new URL('../../../assets/fonts/NotoSans-Bold.ttf', import.meta.url)),
  ]));

const INK = rgb(0.08, 0.08, 0.1);
const MUTED = rgb(0.35, 0.35, 0.4);
const RULE = rgb(0.75, 0.75, 0.8);
const A4: [number, number] = [595.28, 841.89];

const STYLE: Record<
  ResumeTemplate,
  { margin: number; name: number; head: number; body: number; gap: number }
> = {
  classic: { margin: 54, name: 20, head: 11.5, body: 10, gap: 1.35 },
  compact: { margin: 40, name: 17, head: 10.5, body: 9, gap: 1.25 },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `2024-06` → `Jun 2024`; `2024` stays. */
export const shortDate = (d: string) =>
  d.length === 7 ? `${MONTHS[Number(d.slice(5)) - 1]} ${d.slice(0, 4)}` : d;
export const dateRange = (start: string, end: string) =>
  start || end ? `${shortDate(start) || '?'} – ${end ? shortDate(end) : 'Present'}` : '';

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

export async function renderResumePdf(
  c: ResumeContent,
  template: ResumeTemplate,
): Promise<{ pdf: Buffer; pages: number }> {
  const [regularBytes, boldBytes] = await loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  doc.setTitle(`${c.basics.name} – Résumé`);
  doc.setAuthor(c.basics.name);
  doc.setCreator(APP_NAME);
  doc.setProducer(APP_NAME);

  const st = STYLE[template];
  const width = A4[0] - 2 * st.margin;
  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - st.margin;
  const lh = (size: number) => size * st.gap;
  const ensure = (needed: number) => {
    if (y - needed >= st.margin) return;
    page = doc.addPage(A4);
    y = A4[1] - st.margin;
  };
  const write = (text: string, size: number, font = regular, color = INK, x = st.margin, w = width) => {
    for (const l of wrap(text, font, size, w)) {
      ensure(lh(size));
      y -= lh(size);
      page.drawText(l, { x, y: y + size * 0.25, size, font, color });
    }
  };
  /** A line with text on the left and right (a title and its dates). */
  const pair = (left: string, right: string, size: number) => {
    const rw = right ? regular.widthOfTextAtSize(right, size) : 0;
    const lines = wrap(left, bold, size, width - rw - 12);
    lines.forEach((l, i) => {
      ensure(lh(size));
      y -= lh(size);
      page.drawText(l, { x: st.margin, y: y + size * 0.25, size, font: bold, color: INK });
      if (i === 0 && right)
        page.drawText(right, {
          x: st.margin + width - rw,
          y: y + size * 0.25,
          size,
          font: regular,
          color: MUTED,
        });
    });
  };
  const bulletList = (items: string[]) => {
    for (const b of items.filter(Boolean)) {
      const lines = wrap(b, regular, st.body, width - 12);
      lines.forEach((l, i) => {
        ensure(lh(st.body));
        y -= lh(st.body);
        if (i === 0)
          page.drawText('•', {
            x: st.margin + 2,
            y: y + st.body * 0.25,
            size: st.body,
            font: regular,
            color: INK,
          });
        page.drawText(l, {
          x: st.margin + 12,
          y: y + st.body * 0.25,
          size: st.body,
          font: regular,
          color: INK,
        });
      });
    }
  };
  const heading = (title: string) => {
    ensure(lh(st.head) * 3);
    y -= lh(st.head) * 0.8;
    write(title.toUpperCase(), st.head, bold);
    y -= 2;
    page.drawLine({
      start: { x: st.margin, y },
      end: { x: st.margin + width, y },
      thickness: 0.6,
      color: RULE,
    });
    y -= 3;
  };

  // Name, headline and one contact line.
  write(c.basics.name, st.name, bold);
  if (c.basics.label) write(c.basics.label, st.body + 1, regular, MUTED);
  const contact = [
    c.basics.email,
    c.basics.phone,
    c.basics.location,
    ...c.basics.profiles.map((p) => p.url),
  ].filter(Boolean);
  if (contact.length) write(contact.join(' | '), st.body, regular, MUTED);
  if (c.basics.summary) {
    heading('Summary');
    write(c.basics.summary, st.body);
  }
  if (c.education.length) {
    heading('Education');
    for (const e of c.education) {
      pair(e.institution, dateRange(e.startDate, e.endDate), st.body);
      const what = [e.studyType, e.area].filter(Boolean).join(', ');
      const line = [what, e.score ? `Score: ${e.score}` : ''].filter(Boolean).join(' · ');
      if (line) write(line, st.body);
    }
  }
  if (c.work.length) {
    heading('Experience');
    for (const w of c.work) {
      pair(`${w.position}, ${w.name}`, dateRange(w.startDate, w.endDate), st.body);
      bulletList(w.highlights);
    }
  }
  if (c.projects.length) {
    heading('Projects');
    for (const p of c.projects) {
      pair(p.name, p.url, st.body);
      if (p.description) write(p.description, st.body);
      bulletList(p.highlights);
    }
  }
  if (c.skills.length) {
    heading('Skills');
    for (const s of c.skills)
      write(s.keywords.length ? `${s.name}: ${s.keywords.join(', ')}` : s.name, st.body);
  }
  if (c.certificates.length) {
    heading('Certificates');
    for (const x of c.certificates)
      write([x.name, x.issuer, shortDate(x.date)].filter(Boolean).join(' · '), st.body);
  }
  if (c.awards.length) {
    heading('Awards');
    for (const x of c.awards)
      write([x.title, x.awarder, shortDate(x.date)].filter(Boolean).join(' · '), st.body);
  }
  return { pdf: Buffer.from(await doc.save()), pages: doc.getPageCount() };
}
