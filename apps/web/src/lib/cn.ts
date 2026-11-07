import { clsx, type ClassValue } from 'clsx';

/**
 * Class merging that knows our theme (ADR 0015): when two classes set the same property under the
 * same variants, the later one wins, so `cn(buttonVariants(), 'h-12 text-body')` replaces the
 * button's height and size instead of leaving both in the class list. The type scale names
 * (`text-callout`) are sizes, not colours, so `text-callout text-fg-2` keeps both.
 *
 * This replaces tailwind-merge (8.6 KB gzip of the initial load, prompt 3 U0) with the groups this
 * app uses; `cn.test.ts` checks it against tailwind-merge over every class in `src/`. A class this
 * file does not know is never dropped (the safe direction).
 */

/** Type scale steps (ADR 0015) plus Tailwind's own names, which the lint rule keeps out of features. */
const SIZE = new Set(
  'caption callout body headline title display xs sm base lg xl 2xl 3xl 4xl 5xl 6xl 7xl 8xl 9xl'.split(' '),
);
const SHADOW_SIZE = /^(elev-\d|2xs|xs|sm|md|lg|xl|2xl|none|inner)$/;
const WEIGHT = new Set('thin extralight light normal medium semibold bold extrabold black'.split(' '));
const ALIGN = /^(start|end|center|between|around|evenly|stretch|baseline|normal|left|right|justify)$/;
const BORDER_STYLE = /^(solid|dashed|dotted|double|hidden|none)$/;
const LENGTH = /^\[(length:|-?[\d.]+(px|r?em|%|vw|vh|dvh|svh|lvh|ch|ex)?\]|calc\(|clamp\(|min\(|max\()/;
const NUM = /^(\d+(\.\d+)?|px|\[(length:|number:)?[\d.]+(px|r?em)?\])$/;

/** Whole-class groups: each word is one property. */
const WORDS: Record<string, string> = {};
const words = (group: string, list: string) => list.split(' ').forEach((w) => (WORDS[w] = group));
words(
  'display',
  'block inline-block inline flex inline-flex grid inline-grid contents hidden table flow-root list-item table-row table-cell',
);
words('position', 'static fixed absolute relative sticky');
words('visibility', 'visible invisible collapse');
words('sr', 'sr-only not-sr-only');
words('isolation', 'isolate isolation-auto');
words('case', 'uppercase lowercase capitalize normal-case');
words('italic', 'italic not-italic');
words('decoration', 'underline overline line-through no-underline');
words('overflow-text', 'truncate text-ellipsis text-clip');
words('box', 'box-border box-content');
words('flex-dir', 'flex-row flex-row-reverse flex-col flex-col-reverse');
words('flex-wrap', 'flex-wrap flex-wrap-reverse flex-nowrap');
words('grow', 'grow grow-0');
words('shrink', 'shrink shrink-0');
words(
  'transition',
  'transition transition-all transition-colors transition-opacity transition-shadow transition-transform transition-none',
);
words('ring-w', 'ring');
words('ring-inset', 'ring-inset');
words('border-collapse', 'border-collapse border-separate');
words('shadow', 'shadow');
words('outline-w', 'outline');
words(
  'outline-style',
  'outline-none outline-hidden outline-dashed outline-dotted outline-double outline-solid',
);
words('list-style', 'list-none list-disc list-decimal');
words('list-pos', 'list-inside list-outside');
words('snap-type', 'snap-x snap-y snap-both snap-none');
words('snap-align', 'snap-start snap-end snap-center snap-align-none');
words('snap-strict', 'snap-mandatory snap-proximity');
words('wbreak', 'break-normal break-words break-all break-keep');
words('owrap', 'wrap-break-word wrap-anywhere wrap-normal');
words('bg-attach', 'bg-fixed bg-local bg-scroll');
words('bg-repeat', 'bg-repeat bg-no-repeat bg-repeat-x bg-repeat-y bg-repeat-round bg-repeat-space');
words('bg-size', 'bg-auto bg-cover bg-contain');
words(
  'bg-pos',
  'bg-center bg-top bg-bottom bg-left bg-right bg-left-top bg-left-bottom bg-right-top bg-right-bottom bg-top-left bg-top-right bg-bottom-left bg-bottom-right',
);
words('obj-fit', 'object-contain object-cover object-fill object-none object-scale-down');
words('pe', 'pointer-events-none pointer-events-auto');
words('table-layout', 'table-auto table-fixed');
words('fvn', 'normal-nums');
for (const w of ['backdrop-blur', 'blur', 'resize', 'divide-x', 'divide-y', 'grayscale']) WORDS[w] = w;

/** Properties that also set others: a later `p-4` drops an earlier `px-2`, not the other way round. */
const SIDES: Record<string, string[]> = {
  '': ['x', 'y', 't', 'r', 'b', 'l', 's', 'e'],
  x: ['l', 'r', 's', 'e'],
  y: ['t', 'b'],
};
const CORNERS: Record<string, string[]> = {
  '': ['t', 'r', 'b', 'l', 's', 'e', 'tl', 'tr', 'br', 'bl', 'ss', 'se', 'es', 'ee'],
  t: ['tl', 'tr'],
  r: ['tr', 'br'],
  b: ['br', 'bl'],
  l: ['tl', 'bl'],
  s: ['ss', 'es'],
  e: ['se', 'ee'],
};
const INSET: Record<string, string[]> = {
  inset: ['inset-x', 'inset-y', 'top', 'right', 'bottom', 'left', 'start', 'end'],
  'inset-x': ['right', 'left'],
  'inset-y': ['top', 'bottom'],
};

/** Simple prefixes whose value never changes the property (longest first is not needed: exact match). */
const PREFIX = new Set(
  'gap justify align transition bg-clip bg-origin bg-blend mix-blend brightness contrast saturate grayscale backdrop-brightness z opacity order basis grid-cols grid-rows col-span col-start col-end row-span row-start row-end aspect cursor select resize appearance duration delay ease animate origin rotate translate-x translate-y skew-x skew-y backdrop-blur blur leading tracking whitespace line-clamp underline-offset fill accent caret from via to will-change touch columns auto-cols auto-rows grid-flow scale-x scale-y content items justify-items justify-self self place-items place-content place-self min-w min-h max-w max-h space-x space-y gap-x gap-y size w h top right bottom left start end scroll-m scroll-p'.split(
    ' ',
  ),
);

type Group = { g: string; also?: string[] };

const HEADS = new Set([
  ...PREFIX,
  ...'text font shadow ring ring-offset outline outline-offset stroke flex grow shrink object bg bg-linear bg-gradient bg-radial bg-conic scale divide divide-x divide-y inset inset-x inset-y overflow overflow-x overflow-y overscroll overscroll-x overscroll-y'.split(
    ' ',
  ),
]);

/** `max-w-xl` → [`max-w`, `xl`]: the longest known head before a dash outside brackets. */
function headOf(base: string): [string, string] | null {
  const dashes: number[] = [];
  let depth = 0;
  for (let i = 0; i < base.length; i++) {
    const c = base[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === '-' && depth === 0) dashes.push(i);
  }
  for (let i = dashes.length - 1; i >= 0; i--) {
    const at = dashes[i] ?? 0;
    const head = base.slice(0, at);
    if (HEADS.has(head)) return [head, base.slice(at + 1)];
  }
  return null;
}

/** The property a class sets (without variants), or null for a class we do not know. */
function groupOf(base: string): Group | null {
  const word = WORDS[base];
  if (word) return { g: word };

  // Spacing with sides: p, px, py, pt…, m, mx….
  const spacing = /^(p|m)([xytrblse]?)-./.exec(base);
  if (spacing) {
    const [, prop = '', side = ''] = spacing;
    return { g: `${prop}${side}`, also: (SIDES[side] ?? []).map((s) => `${prop}${s}`) };
  }

  // Rounded corners: rounded-lg, rounded-t-lg, rounded-tl-lg.
  const corner = /^rounded(?:-(tl|tr|br|bl|ss|se|es|ee|t|r|b|l|s|e))?(?:-|$)/.exec(base);
  if (corner) {
    const c = corner[1] ?? '';
    return { g: `rounded${c}`, also: (CORNERS[c] ?? []).map((x) => `rounded${x}`) };
  }

  // Borders: width (border-2, border-t), style (border-dashed) or colour (border-line).
  const border = /^border(?:-([xytrblse]))?(?:-(.+))?$/.exec(base);
  if (border) {
    const side = border[1] ?? '';
    const v = border[2];
    const widths = { g: `border-w${side}`, also: (SIDES[side] ?? []).map((s) => `border-w${s}`) };
    if (v === undefined || NUM.test(v)) return widths;
    if (BORDER_STYLE.test(v) && !side) return { g: 'border-style' };
    return { g: `border-c${side}` };
  }

  const parsed = headOf(base);
  if (!parsed) return null;
  const [head, value] = parsed;
  if (head === 'gap') return { g: 'gap', also: ['gap-x', 'gap-y'] };
  if (head === 'size') return { g: 'size', also: ['w', 'h'] };
  // `content-['']` is a pseudo-element's content; `content-center` aligns lines (align-content).
  if (head === 'content' && (value === 'none' || value.startsWith('['))) return { g: 'content-value' };
  if (head in INSET) return { g: head, also: INSET[head] ?? [] };
  if (head === 'overflow' || head === 'overscroll') return { g: head, also: [`${head}-x`, `${head}-y`] };

  switch (head) {
    case 'text':
      if (SIZE.has(value) || LENGTH.test(value)) return { g: 'text-size' };
      if (ALIGN.test(value)) return { g: 'text-align' };
      if (/^(wrap|nowrap|balance|pretty)$/.test(value)) return { g: 'text-wrap' };
      return { g: 'text-color' };
    case 'font':
      return WEIGHT.has(value) || /^\d+$|^\[\d+\]$/.test(value) ? { g: 'font-weight' } : { g: 'font-family' };
    case 'shadow':
      return SHADOW_SIZE.test(value) ||
        /^\[(?!color:|var\(--[\w-]+\)\]|color-mix|#|rgb|oklch|hsl).+\]$/.test(value)
        ? { g: 'shadow' }
        : { g: 'shadow-color' };
    case 'ring':
      return NUM.test(value) ? { g: 'ring-w' } : { g: 'ring-color' };
    case 'ring-offset':
      return NUM.test(value) ? { g: 'ring-offset-w' } : { g: 'ring-offset-color' };
    case 'outline':
      return NUM.test(value) ? { g: 'outline-w' } : { g: 'outline-color' };
    case 'outline-offset':
      return { g: 'outline-offset' };
    case 'stroke':
      return NUM.test(value) ? { g: 'stroke-w' } : { g: 'stroke' };
    case 'flex':
      return { g: 'flex' };
    case 'grow':
    case 'shrink':
      return { g: head };
    case 'object':
      return { g: 'obj-pos' };
    case 'bg':
      // Tailwind 4 reads bg-gradient-to-* and arbitrary gradients as images, not colours.
      if (
        value === 'none' ||
        /^(linear|radial|conic|gradient)|^\[(image:|url\(|(repeating-)?(linear|radial|conic)-gradient)/.test(
          value,
        )
      )
        return { g: 'bg-image' };
      return { g: 'bg-color' };
    case 'bg-linear':
    case 'bg-gradient':
    case 'bg-radial':
    case 'bg-conic':
      return { g: 'bg-image' };
    case 'scale':
      return { g: 'scale', also: ['scale-x', 'scale-y'] };
    case 'divide-x':
    case 'divide-y':
      return { g: head };
    case 'divide':
      return { g: 'divide-color' };
  }
  return { g: head };
}

/** Splits `md:hover:px-2` into its variants and its utility, ignoring colons inside brackets. */
function split(cls: string): [string, string] {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === ':' && depth === 0) cut = i;
  }
  if (cut < 0) return ['', cls];
  // Variant order does not matter (hover:focus: = focus:hover:) except around arbitrary ones.
  const variants = cls.slice(0, cut).split(':');
  const sorted: string[] = [];
  let run: string[] = [];
  for (const v of variants) {
    if (v.startsWith('[')) {
      sorted.push(...run.sort(), v);
      run = [];
    } else run.push(v);
  }
  sorted.push(...run.sort());
  return [`${sorted.join(':')}:`, cls.slice(cut + 1)];
}

const cache = new Map<string, string>();

/** Removes earlier classes overridden by later ones (same property, same variants). */
export function mergeClasses(list: string): string {
  const hit = cache.get(list);
  if (hit !== undefined) return hit;
  const classes = list.split(/\s+/).filter(Boolean);
  const taken = new Set<string>();
  const kept: string[] = [];
  for (let i = classes.length - 1; i >= 0; i--) {
    const cls = classes[i] ?? '';
    const [variants, utility] = split(cls);
    let base = utility;
    let important = '';
    if (base.startsWith('!')) [important, base] = ['!', base.slice(1)];
    else if (base.endsWith('!')) [important, base] = ['!', base.slice(0, -1)];
    if (base.startsWith('-')) base = base.slice(1);
    // Opacity and line-height modifiers (`bg-brand/50`, `text-body/6`) do not change the property.
    const slash = base.lastIndexOf('/');
    if (slash > 0 && !base.slice(slash).includes(']')) base = base.slice(0, slash);
    const group = groupOf(base);
    if (!group) {
      kept.push(cls);
      continue;
    }
    const key = `${variants}${important}${group.g}`;
    if (taken.has(key)) continue;
    taken.add(key);
    for (const g of group.also ?? []) taken.add(`${variants}${important}${g}`);
    kept.push(cls);
  }
  const out = kept.reverse().join(' ');
  if (cache.size > 500) cache.clear();
  cache.set(list, out);
  return out;
}

export const cn = (...inputs: ClassValue[]) => mergeClasses(clsx(inputs));
