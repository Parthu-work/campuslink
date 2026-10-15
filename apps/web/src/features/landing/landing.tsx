import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Mesh } from '../../components/ui/mesh';
import { Avatar, Crest } from '../../components/ui/misc';
import { buttonVariants } from '../../components/ui/button-variants';
import { useTenant } from '../../lib/tenant-context';
import { usePreferences } from '../../lib/preferences';

/**
 * DEMO DATA ONLY. The landing page is public, so it must never show real members' names.
 * When a college opts in (later phase), these become opted-in alumni chosen by the college.
 */
const DEMO_WALL: [string, string, string][] = [
  ['Rahul Varma', 'SDE II · Nimbus Labs', "CSE '19"],
  ['Sneha Reddy', 'Data Analyst · Kestrel Analytics', "ECE '20"],
  ['Arjun Naidu', 'Design Engineer · Ironleaf Motors', "MECH '18"],
  ['Divya Chowdary', 'SRE · Cloudpeak', "IT '17"],
  ['Karthik Rao', 'Product Manager · Lumen Pay', "CSE '16"],
  ['Fatima Begum', 'ML Engineer · Northstar AI', "CSE '20"],
  ['Praveen Goud', 'Site Engineer · Riverline Infra', "CIVIL '19"],
  ['Lakshmi Prasanna', 'Process Engineer · Saltmarsh Chemicals', "CHEM '18"],
  ['Imran Khan', 'Embedded Engineer · Voltix Devices', "EEE '19"],
  ['Meghana Sharma', 'UX Designer · Pixelbay', "CSE '21"],
];

function WallRow({ items, reverse }: { items: typeof DEMO_WALL; reverse?: boolean }) {
  return (
    <div
      className="flex w-max gap-3 motion-safe:animate-[drift_calc(70s/max(var(--motion-scale),0.0001))_linear_infinite] [[data-motion=reduce]_&]:animate-none"
      style={
        reverse
          ? {
              animationDirection: 'reverse',
              animationDuration: 'calc(85s / max(var(--motion-scale), 0.0001))',
            }
          : undefined
      }
    >
      {[...items, ...items].map(([name, role, batch], i) => (
        <div
          key={i}
          className="glass flex min-w-[230px] items-center gap-2.5 rounded-[var(--radius-md)] border border-line py-2.5 pr-4 pl-2.5"
          aria-hidden={i >= items.length}
        >
          <Avatar name={name} verified />
          <div>
            <b className="block text-sm">{name}</b>
            <span className="text-xs text-fg-2">
              {role} · <span className="font-mono">{batch}</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

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
        <Crest monogram={tenant.branding.monogram} />
        <div className="min-w-0 font-display text-sm leading-tight font-semibold">
          {college}
          {tenant.branding.city && (
            <small className="block font-mono text-[11px] font-normal tracking-wide text-fg-2">
              {tenant.branding.city}
            </small>
          )}
        </div>
        <button
          type="button"
          className="ml-auto min-h-11 rounded-full px-3 text-sm font-semibold text-fg-2 hover:text-fg"
          onClick={() => setLanguage(i18n.language === 'te' ? 'en' : 'te')}
          lang={i18n.language === 'te' ? 'en' : 'te'}
        >
          {i18n.language === 'te' ? 'English' : 'తెలుగు'}
        </button>
      </header>
      <main id="main" className="gutter screen-in grid max-w-[780px] gap-6 self-center py-10">
        <span className="eyebrow">{t('landing.eyebrow')}</span>
        <h1 className="text-[clamp(38px,7.2vw,76px)] leading-[0.98] font-bold tracking-[-0.035em] [:root[lang=te]_&]:text-[clamp(30px,5.4vw,56px)] [:root[lang=te]_&]:leading-tight [:root[lang=te]_&]:tracking-normal">
          {t('landing.h1a')}
          <em className="bg-gradient-to-r from-brand-ink to-accent-ink bg-clip-text not-italic text-transparent">
            {t('landing.h1b')}
          </em>
        </h1>
        <p className="max-w-[54ch] text-[clamp(16px,2vw,19px)] text-fg-2">{t('landing.sub', { college })}</p>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link to="/sign-up" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
            {t('landing.join')} <ArrowRight className="size-5" aria-hidden />
          </Link>
          <Link to="/sign-in" className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
            {t('landing.signIn')}
          </Link>
        </div>
      </main>
      <footer>
        <div
          className="grid min-w-0 gap-3 overflow-hidden pt-2 pb-7 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]"
          aria-label={t('landing.wallLabel')}
          role="img"
        >
          <WallRow items={DEMO_WALL.slice(0, 5)} />
          <WallRow items={DEMO_WALL.slice(5)} reverse />
        </div>
        <p className="gutter flex items-center gap-2 pb-[calc(16px+env(safe-area-inset-bottom,0px))] text-xs text-fg-3">
          <ShieldCheck className="size-4 flex-none" aria-hidden /> {t('landing.foot', { college })}
        </p>
      </footer>
    </div>
  );
}
