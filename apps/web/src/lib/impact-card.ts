import { APP_NAME } from '@campuslink/shared';

export interface ImpactCardData {
  name: string;
  college: string;
  /** Already-translated lines: headline ("I mentored 12 students"), and a detail line. */
  headline: string;
  detail: string;
  level: string | null;
}

/** Resolve a design token (CSS custom property) to a concrete colour for canvas drawing. */
function token(name: string, fallback: string) {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Draws the shareable "I mentored N students" card (1200×628, LinkedIn's link-image size) and
 * returns a PNG blob. Only the mentor's own name, college and counts appear on it.
 */
export async function drawImpactCard(d: ImpactCardData): Promise<Blob> {
  const W = 1200;
  const H = 628;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  const brand = token('--brand', '#3fb8e6');
  const brand2 = token('--brand-2', '#6d5ae6');
  const accent = token('--accent', '#f2b705');
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, brand2);
  grad.addColorStop(1, brand);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // Soft constellation dots.
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let i = 0; i < 40; i++) {
    const x = (i * 197) % W;
    const y = (i * 131) % H;
    ctx.beginPath();
    ctx.arc(x, y, (i % 3) + 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const font = token('--font-display', 'system-ui, sans-serif');
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 34px ${font}`;
  ctx.fillText(d.college.slice(0, 60), 72, 110);
  ctx.font = `800 82px ${font}`;
  wrap(ctx, d.headline, 72, 250, W - 144, 92);
  ctx.font = `500 34px ${font}`;
  ctx.fillText(d.detail.slice(0, 80), 72, 430);
  if (d.level) {
    ctx.fillStyle = accent;
    roundRect(ctx, 72, 470, Math.min(520, 40 + d.level.length * 22), 64, 32);
    ctx.fill();
    ctx.fillStyle = '#111111';
    ctx.font = `700 30px ${font}`;
    ctx.fillText(d.level, 96, 512);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `600 28px ${font}`;
  ctx.fillText(`${d.name.slice(0, 40)} · ${APP_NAME}`, 72, H - 48);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png'),
  );
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number) {
  const words = text.split(' ');
  let line = '';
  let row = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > max && line) {
      ctx.fillText(line, x, y + row * lh);
      line = w;
      row++;
    } else line = test;
  }
  ctx.fillText(line, x, y + row * lh);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
