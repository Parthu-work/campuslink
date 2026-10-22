import { spawn } from 'node:child_process';
import { hasTool } from './tools.js';

/** Optical character recognition for scanned pages and images. */
export interface OcrProvider {
  readonly id: string;
  /** Whether recognition can run here (Tesseract installed, for example). */
  available(): Promise<boolean>;
  /** Text in the image, or '' when nothing is recognised. */
  recognise(image: Buffer): Promise<string>;
}

/** No OCR configured: scanned pages are reported as "no text" and still listed. */
export const noOcr: OcrProvider = { id: 'none', available: async () => false, recognise: async () => '' };

/**
 * Tesseract (free, Apache-2.0) through its command line, reading the image from stdin. Languages
 * are configurable (`OCR_LANGUAGES`, for example `eng+tel` with the Telugu pack installed).
 */
export class TesseractOcr implements OcrProvider {
  readonly id = 'tesseract';
  private installed: Promise<boolean> | null = null;
  available() {
    return (this.installed ??= hasTool(this.bin, '--version'));
  }
  constructor(
    private readonly languages = 'eng',
    private readonly bin = 'tesseract',
    private readonly timeoutMs = 120_000,
  ) {}

  recognise(image: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const p = spawn(this.bin, ['stdin', 'stdout', '-l', this.languages, '--psm', '3'], {
        windowsHide: true,
      });
      const out: Buffer[] = [];
      let size = 0;
      const timer = setTimeout(() => p.kill('SIGKILL'), this.timeoutMs);
      p.stdout.on('data', (b: Buffer) => {
        size += b.length;
        if (size <= 2 * 1024 * 1024) out.push(b);
      });
      p.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      p.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(Buffer.concat(out).toString('utf8').trim());
        else reject(new Error(`OCR failed (${code ?? 'killed'})`));
      });
      p.stdin.on('error', () => undefined);
      p.stdin.end(image);
    });
  }
}
