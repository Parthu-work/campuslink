import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { compile } from 'tailwindcss';
import { extendTailwindMerge } from 'tailwind-merge';
import { describe, expect, it } from 'vitest';
import { cn, mergeClasses } from './cn';

/**
 * `cn` replaced tailwind-merge in the initial bundle (prompt 3, U0). tailwind-merge stays a dev
 * dependency as the reference: every pair of classes the app writes must merge the same way.
 */
const reference = extendTailwindMerge({
  extend: {
    theme: {
      text: ['caption', 'callout', 'body', 'headline', 'title', 'display'],
      shadow: ['elev-0', 'elev-1', 'elev-2', 'elev-3', 'elev-4'],
      ease: ['snappy', 'smooth', 'bouncy', 'spring', 'standard', 'emphasised'],
    },
  },
});

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith('.test.ts') ? [p] : [];
  });

/** CSS.escape (the selector Tailwind writes for a class). */
const escape = (s: string) => s.replace(/^\d/, (d) => `\\3${d} `).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);

const styles = new URL('../styles/', import.meta.url).pathname;
const require = createRequire(import.meta.url);

/** The tokens Tailwind turns into a rule with our theme: real classes, not test ids or keys. */
async function realClasses(tokens: string[]): Promise<string[]> {
  const compiler = await compile(readFileSync(join(styles, 'index.css'), 'utf8'), {
    base: styles,
    loadStylesheet: async (id: string, base: string) => {
      const path = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : resolve(base, id);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
  const css = compiler.build(tokens);
  const selectors = new Set(css.match(/\.(?:\\.|[\w-])+/g) ?? []);
  return tokens.filter((t) => selectors.has(`.${escape(t)}`));
}

/**
 * Deliberate differences from tailwind-merge 3: Tailwind 4 reads `bg-gradient-to-*` as an image,
 * so it no longer replaces a background colour (tailwind-merge still calls it a colour).
 */
const DELIBERATE = [/(^| )bg-gradient-to-/];

/** Every class-like token inside string literals in src/ (variants stripped, so pairs compare). */
function corpus(): string[] {
  const out = new Set<string>();
  const src = new URL('..', import.meta.url).pathname;
  for (const file of files(src)) {
    const text = readFileSync(file, 'utf8');
    for (const lit of text.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
      for (const tok of (lit[1] ?? lit[2] ?? lit[3] ?? '').split(/\s+/)) {
        const base = tok.slice(tok.lastIndexOf(':') + 1);
        if (/^!?-?[a-z][a-z0-9]*(-[a-z0-9.[\]%/()_,#'=-]+)*!?$/.test(base) && base.length < 60) out.add(base);
      }
    }
  }
  return [...out].sort();
}

describe('cn', () => {
  it('keeps the later of two classes that set the same property', () => {
    expect(cn('px-2 py-1', 'p-4')).toBe('p-4');
    expect(cn('p-4', 'px-2')).toBe('p-4 px-2');
    expect(cn('text-callout text-fg-2', 'text-body')).toBe('text-fg-2 text-body');
    expect(cn('text-fg-2', 'text-brand-ink')).toBe('text-brand-ink');
    expect(cn('rounded-xl', 'rounded-t-none')).toBe('rounded-xl rounded-t-none');
    expect(cn('rounded-t-none', 'rounded-xl')).toBe('rounded-xl');
    expect(cn('border border-line', 'border-2')).toBe('border-line border-2');
    expect(cn('hover:bg-surface-2', 'hover:bg-surface-3', 'bg-surface-1')).toBe(
      'hover:bg-surface-3 bg-surface-1',
    );
    expect(cn('max-w-xl', 'max-w-[680px]')).toBe('max-w-[680px]');
    expect(cn('shadow-elev-2', 'shadow-none')).toBe('shadow-none');
    expect(cn('font-display', 'font-semibold')).toBe('font-display font-semibold');
    expect(cn('md:hover:p-2', 'hover:md:p-3')).toBe('hover:md:p-3');
    expect(cn('size-5', 'w-6')).toBe('size-5 w-6');
    expect(cn('w-6', 'size-5')).toBe('size-5');
    expect(cn('unknown-a', false, null, undefined, 'unknown-a')).toBe('unknown-a unknown-a');
  });

  it('merges every pair of classes in src/ the way tailwind-merge does', async () => {
    const tokens = await realClasses(corpus());
    expect(tokens.length).toBeGreaterThan(500);
    // Pairs that share a first segment (where conflicts live), in both orders.
    const byHead = new Map<string, string[]>();
    for (const t of tokens) {
      const head = t.replace(/^[!-]/, '').split('-')[0] ?? t;
      byHead.set(head, [...(byHead.get(head) ?? []), t]);
    }
    const diffs: string[] = [];
    for (const group of byHead.values())
      for (const a of group)
        for (const b of group) {
          if (a === b || DELIBERATE.some((d) => d.test(`${a} ${b}`))) continue;
          const mine = mergeClasses(`${a} ${b}`);
          const theirs = reference(`${a} ${b}`);
          if (mine !== theirs) diffs.push(`${a} ${b} → ${mine} | tailwind-merge: ${theirs}`);
        }
    expect(diffs).toEqual([]);
  });
});
