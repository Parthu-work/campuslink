/**
 * Axis ticks from 0 to just past `max`, on round steps (1, 2 or 5 × a power of ten), at most
 * `count` steps: 0 / 500 / 1,000 / 1,500 rather than 0 / 437 / 874.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** Which of `n` category labels to print so at most `most` show, evenly spaced, always the last. */
export function labelEvery(n: number, most: number): (i: number) => boolean {
  const every = Math.max(1, Math.ceil(n / Math.max(1, most)));
  return (i) => i === n - 1 || (i % every === 0 && n - 1 - i >= every / 2);
}
