import {
  SafeFetchError,
  type SafeFetchOptions,
  type SafeResponse,
  type safeFetch,
} from '../src/lib/safe-fetch.js';
import { api, type TestTenant, type TestUser, type testApp } from './helpers.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { strToU8, zipSync } from 'fflate';
import sharp from 'sharp';
import type { MediaTools } from '../src/modules/study/media/tools.js';
import type { OcrProvider } from '../src/modules/study/media/ocr.js';
import type { TranscriptionProvider } from '../src/modules/study/media/transcribe.js';

/** Demo keys: obviously fake, and the provider's error echoes the bad one (as real ones do). */
export const GOOD_KEY = 'sk-ant-demo-GOOD-1111222233334444';
export const BAD_KEY = 'sk-ant-demo-BAD-9999888877776666';
export const OPENAI_KEY = 'sk-demo-openai-5555666677778888';
export const YOUTUBE_KEY = 'AIzaDemoYoutubeKey000011112222';

const json = (status: number, body: unknown): SafeResponse => ({
  status,
  contentType: 'application/json',
  body: Buffer.from(JSON.stringify(body)),
  finalUrl: '',
  headers: {},
});

export interface FakeCall {
  url: string;
  opts: SafeFetchOptions;
  body: Record<string, unknown> | null;
}

/** A fake SSRF-safe fetcher that answers like the AI providers do (no network). */
export function aiFetcher() {
  const calls: FakeCall[] = [];
  const fn = (async (url: string, opts: SafeFetchOptions = {}) => {
    const body = typeof opts.body === 'string' ? (JSON.parse(opts.body) as Record<string, unknown>) : null;
    calls.push({ url, opts, body });
    const h = opts.headers ?? {};
    if (url.startsWith('https://api.anthropic.com/v1/models')) {
      if (h['x-api-key'] === GOOD_KEY)
        return json(200, { data: [{ id: 'claude-opus-5-5' }, { id: 'claude-haiku-5-5' }] });
      return json(401, {
        type: 'error',
        error: { type: 'authentication_error', message: `invalid x-api-key ${h['x-api-key']}` },
      });
    }
    if (url === 'https://api.openai.com/v1/models') {
      if (h.authorization === `Bearer ${OPENAI_KEY}`)
        return json(200, { data: [{ id: 'text-embedding-demo' }, { id: 'chat-demo' }] });
      return json(401, { error: { message: `Incorrect API key provided: ${h.authorization}` } });
    }
    if (url.startsWith('http://ollama.test:11434/')) {
      if (!opts.allowPrivateNetwork) throw new SafeFetchError('Destination address is not allowed');
      return json(200, { data: [{ id: 'local-model' }] });
    }
    if (url.startsWith('https://www.googleapis.com/youtube/v3/')) {
      return h['x-goog-api-key'] === YOUTUBE_KEY
        ? json(200, { items: [] })
        : json(400, { error: { message: `API key not valid: ${h['x-goog-api-key']}` } });
    }
    if (url.startsWith('https://www.youtube.com/oembed')) {
      if (url.includes('NotThereXXX')) return json(404, {});
      return json(200, {
        title: 'Demo: pumping lemma, explained',
        author_name: 'Demo Channel',
        type: 'video',
      });
    }
    if (url.startsWith('https://vimeo.com/api/oembed.json'))
      return json(200, { title: 'Demo: DFA minimisation', author_name: 'Demo Vimeo', duration: 754 });
    throw new SafeFetchError('Could not fetch that URL');
  }) as unknown as typeof safeFetch;
  return { fn, calls };
}

export const FLAT_SYLLABUS = [
  'UNIT - I: Finite Automata: Alphabet, strings and languages; DFA, NFA, Equivalence of NFA and DFA',
  'UNIT - II Regular Expressions',
  '1. Regular expressions and regular languages',
  '2. Pumping lemma for regular languages',
  'Unit III: Context-Free Grammars',
  '- Derivations and parse trees, ambiguity (with examples)',
].join('\n');

export interface SubjectInput {
  name?: string;
  code?: string;
  branches?: string[];
  batches?: number[];
  semester?: number | null;
  ownerIds?: string[];
}

export async function makeSubject(
  ctx: ReturnType<typeof testApp>,
  tenant: TestTenant,
  as: TestUser,
  input: SubjectInput = {},
): Promise<{ id: string }> {
  const r = await api(ctx, tenant.host, as.token)
    .post('/study/subjects')
    .send({
      name: 'Demo Formal Languages and Automata Theory',
      code: `FLAT${Math.floor(Math.random() * 1e6)}`,
      branches: ['CSE'],
      batches: [2027],
      semester: 5,
      ...input,
    });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body.data as { id: string };
}

// ── Material fixtures (all text is demo text written for these tests) ─────────────────────────

/** A PDF with a text layer: one array of lines per page (the first line is set larger, as a heading). */
export async function textPdf(pages: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setAuthor('SECRET-PDF-AUTHOR');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const p = doc.addPage([500, 700]);
    lines.forEach((line, i) => p.drawText(line, { x: 40, y: 650 - i * 22, size: i === 0 ? 18 : 11, font }));
  }
  return Buffer.from(await doc.save());
}

/** A "scanned" PDF: one page that is only an image (no text layer). */
export async function scannedPdf(): Promise<Buffer> {
  const png = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  doc.addPage([300, 200]).drawImage(img, { x: 0, y: 0, width: 300, height: 200 });
  return Buffer.from(await doc.save());
}

const CT =
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>';

/** A minimal Word document: a Heading1 paragraph, then body paragraphs. */
export function docx(heading: string, paragraphs: string[]): Buffer {
  const p = (t: string, style?: string) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  const body = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p(heading, 'Heading1')}${paragraphs.map((x) => p(x)).join('')}</w:body></w:document>`;
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        `${CT}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      ),
      '_rels/.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      'word/document.xml': strToU8(body),
    }),
  );
}

/** A minimal slide deck: each slide's text lines, and speaker notes. */
export function pptx(slides: { lines: string[]; notes?: string }[]): Buffer {
  const a = (t: string) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `${CT}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    ),
    'ppt/presentation.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
    ),
  };
  slides.forEach((s, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${s.lines.map(a).join('')}</p:spTree></p:cSld></p:sld>`,
    );
    if (s.notes)
      files[`ppt/notesSlides/notesSlide${i + 1}.xml`] = strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${a(String(i + 1))}${a(s.notes)}</p:notes>`,
      );
  });
  return Buffer.from(zipSync(files));
}

export const DEMO_VTT = [
  'WEBVTT',
  '',
  '00:00:00.000 --> 00:00:04.000',
  'Welcome to this demo lecture on automata.',
  '',
  '00:00:04.000 --> 00:00:09.500',
  'A DFA reads one symbol at a time.',
  '',
  '00:01:05.000 --> 00:01:12.000',
  'The pumping lemma helps show a language is not regular.',
].join('\n');

/** Media tools that need no binaries: a fixed duration and a small poster frame. */
export function fakeMedia(): MediaTools & { audioCalls: number } {
  const t = {
    audioCalls: 0,
    probe: async () => ({ durationSec: 90 }),
    thumbnail: async () =>
      sharp({ create: { width: 32, height: 18, channels: 3, background: '#223344' } })
        .jpeg()
        .toBuffer(),
    audio: async () => {
      t.audioCalls++;
      return Buffer.from('demo-audio');
    },
    pdfPages: async (_d: Buffer, pages: number[]) => pages.map(() => Buffer.from('demo-page-image')),
  };
  return t;
}

/** OCR that "reads" a fixed sentence (or is unavailable). */
export function fakeOcr(
  available = true,
  text = 'Demo scanned notes: a Turing machine has an infinite tape.',
): OcrProvider {
  return { id: 'fake', available: async () => available, recognise: async () => text };
}

export function fakeTranscriber(): TranscriptionProvider {
  return {
    id: 'fake',
    transcribe: async () => [
      { start: 0, end: 5, text: 'Demo transcript: today we study context-free grammars.' },
      { start: 30, end: 36, text: 'A parse tree shows how a string is derived.' },
    ],
  };
}
