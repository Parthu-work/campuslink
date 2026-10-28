import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { Mesh } from '../ui/mesh';
import { Crest } from '../ui/misc';
import { useTenant } from '../../lib/tenant-context';

/** Split layout: branded mesh panel (desktop) beside the form; stacked on phones. */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string | undefined;
  children: ReactNode;
}) {
  const tenant = useTenant();
  const { t } = useTranslation();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
      <aside className="relative hidden overflow-hidden lg:block" aria-hidden>
        <Mesh className="absolute inset-0 size-full saturate-[1.15]" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_110%,var(--bg)_20%,transparent_70%)]" />
        <div className="absolute bottom-12 left-12 max-w-md">
          <p className="eyebrow">{t('landing.eyebrow')}</p>
          <p className="mt-3 font-display text-display leading-tight font-bold">
            {t('landing.h1a')}
            <span className="bg-gradient-to-r from-brand-ink to-accent-ink bg-clip-text text-transparent">
              {t('landing.h1b')}
            </span>
          </p>
        </div>
      </aside>
      <main
        id="main"
        className="gutter grid content-start gap-7 py-[calc(28px+env(safe-area-inset-top,0px))] lg:content-center lg:px-14"
      >
        <Link to="/" className="flex items-center gap-3 self-start rounded-md">
          <Crest monogram={tenant.branding.monogram} logoUrl={tenant.logoUrl} />
          <span className="font-display text-body leading-tight font-semibold">
            {tenant.branding.displayName}
          </span>
        </Link>
        <div className="screen-in grid w-full max-w-[440px] gap-6">
          <header className="grid gap-2">
            <h1 className="text-[clamp(28px,5vw,36px)] leading-[1.08] font-bold">{title}</h1>
            {subtitle && <p className="text-fg-2">{subtitle}</p>}
          </header>
          {children}
        </div>
        <p className="flex max-w-[440px] items-start gap-2 text-caption text-fg-3">
          <ShieldCheck className="mt-px size-4 flex-none" aria-hidden />
          {t('landing.foot', { college: tenant.branding.displayName })}
        </p>
      </main>
    </div>
  );
}

export function FormError({ message }: { message?: string | undefined }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3.5 py-2.5 text-meta text-fg"
    >
      {message}
    </p>
  );
}
