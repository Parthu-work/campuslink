import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ensureContrast, onColor, type PublicTenant } from '@campuslink/shared';
import { api, ApiError } from './api';

const INK_RATIO = 5.5;

export const TenantContext = createContext<PublicTenant | null>(null);

/**
 * Applies a college's branding as design tokens. Inks are contrast-corrected for each theme with a
 * 5.5:1 target, which keeps them above WCAG AA (4.5:1) on the lightly tinted surfaces used by badges.
 */
export function applyBranding(b: PublicTenant['branding']) {
  const s = document.documentElement.style;
  s.setProperty('--brand', b.primary);
  s.setProperty('--brand-2', b.secondary);
  s.setProperty('--accent', b.accent);
  s.setProperty('--brand-ink-dark', ensureContrast(b.primary, '#0d1222', INK_RATIO));
  s.setProperty('--accent-ink-dark', ensureContrast(b.accent, '#0d1222', INK_RATIO));
  s.setProperty('--brand-ink-light', ensureContrast(b.primary, '#ffffff', INK_RATIO));
  s.setProperty('--accent-ink-light', ensureContrast(b.accent, '#ffffff', INK_RATIO));
  s.setProperty('--on-brand', onColor(b.primary));
  s.setProperty('--on-accent', onColor(b.accent));
}

export function useTenantQuery() {
  return useQuery({
    queryKey: ['tenant'],
    queryFn: ({ signal }) => api.get<PublicTenant>('/tenant', signal),
    staleTime: 5 * 60_000,
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
  });
}

export function useTenant(): PublicTenant {
  const t = useContext(TenantContext);
  if (!t) throw new Error('useTenant outside TenantProvider');
  return t;
}
