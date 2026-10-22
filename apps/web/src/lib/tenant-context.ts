import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { generatePalette, themeCss, type PublicTenant } from '@campuslink/shared';
import { tenant as tenantQuery } from './queries';
import { setChromeColours } from './preferences';

export const TenantContext = createContext<PublicTenant | null>(null);

/**
 * Applies a college's colours: the whole palette (tinted neutrals, brand ramp, contrast-checked
 * inks, aurora, subject accents) is generated from its primary hue and accent (ADR 0008) and
 * replaces the default from palette.css. Its exact colours are used only for its logo.
 */
export function applyBranding(b: Pick<PublicTenant['branding'], 'primary' | 'accent'>) {
  const palette = generatePalette({ primary: b.primary, accent: b.accent });
  let style = document.getElementById('college-palette') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'college-palette';
    document.head.append(style);
  }
  style.textContent = themeCss(palette);
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
