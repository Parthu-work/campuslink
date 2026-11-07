import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Feature, PublicTenant, TenantPalette } from '@campuslink/shared';
import { tenant as tenantQuery } from './queries';
import { setChromeColours } from './preferences';

export const TenantContext = createContext<PublicTenant | null>(null);

const block = (t: Record<string, string>, indent: string) =>
  Object.entries(t)
    .map(([k, v]) => `${indent}${k}: ${v};`)
    .join('\n');

/**
 * Applies a college's colours: the whole palette (tinted neutrals, brand ramp, contrast-checked
 * inks, aurora, subject accents), generated from its primary hue and accent (ADR 0008) by the API
 * (`PublicTenant.palette`), replaces the default from palette.css. The theme selectors match
 * `themeCss()` in packages/shared/src/palette.ts (dark first). Its exact colours are only for its logo.
 */
export function applyBranding(palette: TenantPalette | undefined) {
  // A tenant saved by an older version (the offline copy) has no palette: keep the default until
  // the next read brings it.
  if (!palette) return;
  let style = document.getElementById('college-palette') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'college-palette';
    document.head.append(style);
  }
  style.textContent = [
    `:root {\n${block(palette.dark, '  ')}\n}`,
    `@media (prefers-color-scheme: light) {\n  :root:not([data-theme='dark']) {\n${block(palette.light, '    ')}\n  }\n}`,
    `:root[data-theme='light'] {\n${block(palette.light, '  ')}\n}`,
  ].join('\n');
  setChromeColours(palette.chrome);
}

export function useTenantQuery() {
  return useQuery(tenantQuery());
}

export function useTenant(): PublicTenant {
  const t = useContext(TenantContext);
  if (!t) throw new Error('useTenant outside TenantProvider');
  return t;
}

/** Whether the college has a feature switched on (Admin › Features; the API enforces it). */
export function useFeature(feature: Feature): boolean {
  return useTenant().features?.[feature] !== false;
}
