import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import en from '../../i18n/en.json';
import { FIRST_PAINT_SLOTS } from '../../lib/first-paint';
import { Headline, LandingFrame } from './frame';

const indexHtml = readFileSync(fileURLToPath(new URL('../../../index.html', import.meta.url)), 'utf8');
const bootJs = readFileSync(fileURLToPath(new URL('../../../public/boot.js', import.meta.url)), 'utf8');
/** Markup without the whitespace between tags (index.html is formatted, React's output is not). */
const squash = (s: string) =>
  s.replace(/>\s+</g, '><').replace(/>\s+/g, '>').replace(/\s+</g, '<').replace(/\s+/g, ' ').trim();

describe("the landing's first paint (prompt 3, U4)", () => {
  const start = indexHtml.indexOf('<div id="fp"');
  const end = indexHtml.indexOf('<!-- /fp -->');
  const fp = indexHtml.slice(start, end);

  it('index.html draws exactly the frame and English headline the app renders', () => {
    // Before #root (which fills the screen), so the headline is always on the first screen.
    expect(start).toBeGreaterThan(0);
    expect(end).toBeLessThan(indexHtml.indexOf('<div id="root"'));
    expect(end).toBeGreaterThan(start);
    const app = renderToStaticMarkup(
      <LandingFrame id="fp" headline={<Headline a={en.landing.h1a} b={en.landing.h1b} />} />,
    );
    // The headline's words keep their spaces ("help <em>"): compare them apart from the tags.
    expect(fp).toContain(`${en.landing.h1a.trim()} <em>${en.landing.h1b}</em>`);
    expect(squash(fp)).toBe(squash(app));
  });

  it('has a slot for every part the landing renders into', () => {
    for (const s of FIRST_PAINT_SLOTS) expect(fp).toContain(`data-slot="${s}"`);
  });

  it('is turned on only for "/" in English, outside the installed app, for devices not signed in', () => {
    expect(bootJs).toContain("location.pathname === '/'");
    expect(bootJs).toContain("lang !== 'te'");
    expect(bootJs).toContain("lang !== 'hi'");
    expect(bootJs).toContain('(display-mode: standalone)');
    expect(bootJs).toContain("localStorage.getItem('cl:member')");
  });
});
