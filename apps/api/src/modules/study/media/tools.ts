import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The media work the pipeline needs: duration, a poster frame, audio for transcription, and PDF
 * pages as images for OCR. `CliMediaTools` uses ffprobe, ffmpeg and pdftoppm (installed in the
 * worker image, `deploy/worker.Dockerfile`); without them the pipeline still indexes what it can.
 *
 * Inputs are written to a private temporary directory for the tools to read and removed straight
 * after: this is processing scratch space, never storage (files are stored only by FilesService).
 */
export interface MediaTools {
  probe(data: Buffer): Promise<{ durationSec: number | null }>;
  thumbnail(data: Buffer, atSec: number): Promise<Buffer | null>;
  /** Mono 16 kHz MP3 (small enough for transcription services), or null. */
  audio(data: Buffer): Promise<Buffer | null>;
  /** The given 1-based pages of a PDF as PNG images (150 dpi), or [] when unavailable. */
  pdfPages(data: Buffer, pages: number[]): Promise<Buffer[]>;
}

export const noMediaTools: MediaTools = {
  probe: async () => ({ durationSec: null }),
  thumbnail: async () => null,
  audio: async () => null,
  pdfPages: async () => [],
};

const run = (bin: string, args: string[], timeoutMs: number) =>
  new Promise<string>((resolve, reject) =>
    execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout))),
    ),
  );

async function inScratch<T>(
  data: Buffer,
  ext: string,
  fn: (dir: string, input: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'study-'));
  try {
    const input = join(dir, `input${ext}`);
    await writeFile(input, data, { mode: 0o600 });
    return await fn(dir, input);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export class CliMediaTools implements MediaTools {
  constructor(
    private readonly bins = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', pdftoppm: 'pdftoppm' },
    private readonly timeoutMs = 10 * 60_000,
  ) {}

  async probe(data: Buffer) {
    try {
      return await inScratch(data, '', async (_dir, input) => {
        const out = await run(
          this.bins.ffprobe,
          ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', input],
          60_000,
        );
        const d = Number(out.trim());
        return { durationSec: Number.isFinite(d) && d > 0 ? Math.round(d) : null };
      });
    } catch {
      return { durationSec: null };
    }
  }

  async thumbnail(data: Buffer, atSec: number) {
    try {
      return await inScratch(data, '', async (dir, input) => {
        const out = join(dir, 'thumb.jpg');
        await run(
          this.bins.ffmpeg,
          [
            '-v',
            'error',
            '-ss',
            String(Math.max(0, atSec)),
            '-i',
            input,
            '-frames:v',
            '1',
            '-vf',
            'scale=640:-2',
            '-y',
            out,
          ],
          120_000,
        );
        return await readFile(out);
      });
    } catch {
      return null;
    }
  }

  async audio(data: Buffer) {
    try {
      return await inScratch(data, '', async (dir, input) => {
        const out = join(dir, 'audio.mp3');
        await run(
          this.bins.ffmpeg,
          ['-v', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', '-y', out],
          this.timeoutMs,
        );
        return await readFile(out);
      });
    } catch {
      return null;
    }
  }

  async pdfPages(data: Buffer, pages: number[]) {
    if (!pages.length) return [];
    try {
      return await inScratch(data, '.pdf', async (dir, input) => {
        const images: Buffer[] = [];
        for (const p of pages) {
          const prefix = join(dir, `p${p}`);
          await run(
            this.bins.pdftoppm,
            ['-r', '150', '-png', '-f', String(p), '-l', String(p), input, prefix],
            120_000,
          );
          const file = (await readdir(dir)).find((n) => n.startsWith(`p${p}`) && n.endsWith('.png'));
          images.push(file ? await readFile(join(dir, file)) : Buffer.alloc(0));
        }
        return images;
      });
    } catch {
      return [];
    }
  }
}

/** True when a command-line tool answers `-version` (used to pick adapters at start-up). */
export async function hasTool(bin: string, arg = '-version'): Promise<boolean> {
  try {
    await run(bin, [arg], 5000);
    return true;
  } catch {
    return false;
  }
}
