/** A page of extracted text; `headings` are lines set noticeably larger than the page's body text. */
export interface ExtractedPage {
  page: number;
  text: string;
  headings: string[];
}

interface TextItem {
  str: string;
  hasEOL: boolean;
  transform: number[];
}

/** Pages with fewer characters than this probably are scans: they go to OCR when it is available. */
export const SCANNED_PAGE_CHARS = 25;

/**
 * The text layer of a PDF, page by page, with line breaks where the PDF has them and headings
 * detected by font size. pdf.js runs without eval, system fonts or font loading (text only). Any
 * page that fails to parse becomes an empty page rather than failing the document.
 */
export async function extractPdf(
  data: Buffer,
  maxPages = 2000,
): Promise<{ pages: ExtractedPage[]; pageCount: number }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    const pdf = await task.promise;
    const pageCount = pdf.numPages;
    const pages: ExtractedPage[] = [];
    for (let n = 1; n <= Math.min(pageCount, maxPages); n++) {
      try {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        const items = (content.items as TextItem[]).filter((i) => typeof i.str === 'string');
        const sizes = items
          .filter((i) => i.str.trim())
          .map((i) => Math.abs(i.transform[3] ?? i.transform[0] ?? 0));
        const body = median(sizes);
        const lines: { text: string; size: number }[] = [];
        let cur = '';
        let size = 0;
        for (const it of items) {
          cur += it.str;
          size = Math.max(size, Math.abs(it.transform[3] ?? it.transform[0] ?? 0));
          if (it.hasEOL) {
            lines.push({ text: cur, size });
            cur = '';
            size = 0;
          }
        }
        if (cur) lines.push({ text: cur, size });
        const kept = lines
          .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
          .filter((l) => l.text);
        pages.push({
          page: n,
          text: kept.map((l) => l.text).join('\n'),
          headings: kept
            .filter((l) => body > 0 && l.size >= body * 1.25 && l.text.length <= 120)
            .map((l) => l.text),
        });
        page.cleanup();
      } catch {
        pages.push({ page: n, text: '', headings: [] });
      }
    }
    return { pages, pageCount };
  } finally {
    await task.destroy();
  }
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  // The lower middle: with few items a heading must not become "the body size".
  return s[Math.floor((s.length - 1) / 2)] ?? 0;
}
