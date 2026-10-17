import { useEffect, type ReactNode } from 'react';
import type { PublicTenant } from '@campuslink/shared';
import { applyBranding, TenantContext } from './tenant-context';
import { setBotCheck } from './bot-check';

export function TenantProvider({ tenant, children }: { tenant: PublicTenant; children: ReactNode }) {
  useEffect(() => {
    applyBranding(tenant.branding);
    setBotCheck(tenant.botCheck ?? null);
    document.title = tenant.branding.displayName;
  }, [tenant]);
  return <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>;
}
