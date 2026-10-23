import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRight, BriefcaseBusiness, Compass, Orbit, ShieldCheck } from 'lucide-react';
import { Mesh } from '../../components/ui/mesh';
import { Crest } from '../../components/ui/misc';
import { buttonVariants } from '../../components/ui/button-variants';
import { useTenant } from '../../lib/tenant-context';
import { usePreferences } from '../../lib/preferences';

export function LandingPage() {
  const tenant = useTenant();
  const { t } = useTranslation();
  const { setLanguage } = usePreferences();
  const { i18n } = useTranslation();
  const college = tenant.branding.displayName;
  return (
    <div className="relative isolate grid min-h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto] overflow-hidden">
      <Mesh className="absolute inset-0 -z-20 size-full saturate-[1.15]" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(120%_80%_at_50%_110%,var(--bg)_25%,transparent_70%)]" />
      <header className="gutter flex items-center gap-3 pt-[calc(18px+env(safe-area-inset-top,0px))]">
        <Crest monogram={tenant.branding.monogram} logoUrl={tenant.logoUrl} />
        <div className="min-w-0 font-display text-meta leading-tight font-semibold">
          {college}
          {tenant.branding.city && (
            <small className="block text-caption font-normal text-fg-2">{tenant.branding.city}</small>
          )}
        </div>
        <button
          type="button"
          className="ml-auto min-h-11 rounded-full px-3 text-meta font-semibold text-fg-2 hover:bg-hover hover:text-fg"
          onClick={() => setLanguage(i18n.language === 'te' ? 'en' : 'te')}
          lang={i18n.language === 'te' ? 'en' : 'te'}
        >
          {i18n.language === 'te' ? 'English' : 'తెలుగు'}
        </button>
      </header>
      <main id="main" className="gutter screen-in grid max-w-[880px] gap-6 self-center py-10">
        <span className="hidden sm:block">
          <Crest monogram={tenant.branding.monogram} logoUrl={tenant.logoUrl} size={64} />
        </span>
        <span className="eyebrow">{t('landing.eyebrow')}</span>
        <h1 className="text-hero leading-[0.98] font-bold tracking-[-0.035em] [:root[lang=te]_&]:text-display [:root[lang=te]_&]:leading-tight [:root[lang=te]_&]:tracking-normal">
          {t('landing.h1a')}
          <em className="bg-gradient-to-r from-brand-ink to-accent-ink bg-clip-text not-italic text-transparent">
            {t('landing.h1b')}
          </em>
        </h1>
        <p className="max-w-[54ch] text-lead text-fg-2">{t('landing.sub', { college })}</p>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link to="/sign-up" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
            {t('landing.join')} <ArrowRight className="size-5" aria-hidden />
          </Link>
          <Link to="/sign-in" className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
            {t('landing.signIn')}
          </Link>
        </div>
        {/* What the network is for, in words: no counts or faces until they are real (D3). */}
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {(
            [
              ['mentors', Compass],
              ['roadmaps', Orbit],
              ['jobs', BriefcaseBusiness],
            ] as const
          ).map(([k, Icon]) => (
            <li key={k} className="glass grid gap-1.5 rounded-[var(--radius-lg)] border border-line p-4">
              <Icon className="size-5 text-brand-ink" aria-hidden />
              <b className="text-body">{t(`landing.points.${k}`)}</b>
              <span className="text-meta text-fg-2">{t(`landing.points.${k}Body`)}</span>
            </li>
          ))}
        </ul>
      </main>
      {/* No people or numbers here: social proof stays off until it is real (decisions D3). */}
      <footer>
        <p className="gutter flex items-center gap-2 pb-[calc(16px+env(safe-area-inset-bottom,0px))] text-caption text-fg-3">
          <ShieldCheck className="size-4 flex-none" aria-hidden /> {t('landing.foot', { college })}
        </p>
      </footer>
    </div>
  );
}
