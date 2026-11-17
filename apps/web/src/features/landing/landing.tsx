import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { LOCALE_NAMES, SUPPORTED_LOCALES, toLocale } from '@campuslink/shared';
import { ArrowDown, ArrowRight, ShieldCheck } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import { Mesh } from '../../components/ui/mesh';
import { Crest } from '../../components/ui/misc';
import { buttonVariants } from '../../components/ui/button-variants';
import { useTenant } from '../../lib/tenant-context';
import { usePreferences } from '../../lib/preferences';
import { intentPreload, preloadWhenIdle } from '../../lib/preload';
import { publicOutcomes } from '../../lib/queries';
import {
  claimFirstPaint,
  FIRST_PAINT_SLOTS,
  holdFirstPaint,
  type FirstPaintSlot,
} from '../../lib/first-paint';
import { Headline, LandingFrame } from './frame';

/** Screenshots of the seeded demo (`e2e/audit/landing-shots.audit.ts`), per theme and language. */
type ShotName = 'home' | 'mentors' | 'drives' | 'paths';
const SHOT_SIZE: Record<ShotName, [number, number]> = {
  home: [720, 1560],
  mentors: [720, 880],
  drives: [720, 880],
  paths: [720, 880],
};

function Shot({ name, alt }: { name: ShotName; alt: string }) {
  const { theme } = usePreferences();
  const { i18n } = useTranslation();
  const lang = toLocale(i18n.language);
  const [width, height] = SHOT_SIZE[name];
  const src = (mode: 'light' | 'dark') => `/landing/${name}-${mode}-${lang}.webp`;
  const img = (s: string) => (
    <img
      src={s}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      className="block h-auto w-full"
    />
  );
  if (theme !== 'system') return img(src(theme));
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet={src('dark')} />
      {img(src('light'))}
    </picture>
  );
}

function Header() {
  const tenant = useTenant();
  const { i18n } = useTranslation();
  const { setLanguage } = usePreferences();
  return (
    <>
      <Crest monogram={tenant.branding.monogram} logoUrl={tenant.logoUrl} />
      <div className="ml-3 min-w-0 text-callout leading-tight font-semibold">
        {/* Three lines on a phone beside the language names, so a long name is not cut short. */}
        <span className="line-clamp-3 sm:line-clamp-2">{tenant.branding.displayName}</span>
        {tenant.branding.city && (
          <small className="hidden truncate text-caption font-normal text-fg-2 sm:block">
            {tenant.branding.city}
          </small>
        )}
      </div>
      <div className="ml-auto flex shrink-0 gap-1">
        {SUPPORTED_LOCALES.filter((l) => l !== i18n.language).map((l) => (
          <button
            key={l}
            type="button"
            className="min-h-11 rounded-full px-3 font-native text-callout font-semibold text-fg-2 hover:bg-hover hover:text-fg"
            onClick={() => setLanguage(l)}
            lang={l}
          >
            {LOCALE_NAMES[l]}
          </button>
        ))}
      </div>
    </>
  );
}

/** Under the headline: what it is, in one sentence, and one action (Join), with Sign in as a link. */
function Copy() {
  const tenant = useTenant();
  const { t } = useTranslation();
  return (
    <>
      <p className="max-w-[54ch] text-body text-fg-2">
        {t('landing.sub', { college: tenant.branding.displayName })}
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link
          to="/sign-up"
          className={buttonVariants({ variant: 'primary', size: 'lg' })}
          {...intentPreload('/sign-up')}
        >
          {/* The button promises only what the next screen does: email where no code can be sent. */}
          {tenant.phoneSignIn ? t('landing.joinPhone') : t('landing.join')}{' '}
          <ArrowRight className="size-5" aria-hidden />
        </Link>
        <p className="text-callout text-fg-2">
          {t('landing.haveAccount')}{' '}
          <Link
            to="/sign-in"
            className="hit font-semibold text-brand-ink hover:underline"
            {...intentPreload('/sign-in')}
          >
            {t('landing.signIn')}
          </Link>
        </p>
      </div>
      {/* On a phone the picture starts just below the first screen: say so at its foot. */}
      <a
        href="#landing-shot"
        className="hit mt-auto flex items-center gap-1.5 self-start text-callout font-semibold text-fg-2 hover:text-fg lg:hidden"
      >
        {t('landing.seeIt')} <ArrowDown className="size-4" aria-hidden />
      </a>
    </>
  );
}

/** The product: the demo student's Home in a phone frame, labelled as demo data (never a mock-up). */
function Figure() {
  const { t } = useTranslation();
  return (
    <figure id="landing-shot" className="mx-auto grid w-60 scroll-mt-20 justify-items-center gap-2.5 lg:w-64">
      <div className="w-full overflow-hidden rounded-[var(--radius-xl)] bg-surface-1 p-1.5 ring-1 ring-line">
        <div className="overflow-hidden rounded-[var(--radius-md)]">
          <Shot name="home" alt={t('landing.shots.home')} />
        </div>
      </div>
      <figcaption className="rounded-full border border-line px-2.5 py-0.5 text-caption font-medium text-fg-2">
        {t('landing.demoData')}
      </figcaption>
    </figure>
  );
}

const SECTIONS = ['mentors', 'drives', 'paths'] as const;

/** The college's published outcomes (G8), only while it publishes them; nothing else here is a number. */
function Outcomes() {
  const tenant = useTenant();
  const { t } = useTranslation();
  const { data } = useQuery(publicOutcomes());
  if (!data) return null;
  const year = data.years.find((y) => y.placementPct !== null);
  const recruiters = data.recruiters.slice(0, 5).map((r) => r.company);
  const figures: { value: string; label: string }[] = [
    ...(year
      ? [{ value: `${year.placementPct}%`, label: t('landing.placed', { year: year.gradYear }) }]
      : []),
    ...(data.mentoringHours > 0
      ? [
          {
            value: String(data.mentoringHours),
            label: t('landing.mentoringHours', { count: data.mentoringHours }),
          },
        ]
      : []),
  ];
  if (!figures.length && !recruiters.length) return null;
  return (
    <section aria-labelledby="landing-numbers" className="grid gap-4 border-t border-line pt-10">
      <h2 id="landing-numbers" className="text-title font-semibold">
        {t('landing.numbers', { college: tenant.branding.shortName })}
      </h2>
      {figures.length > 0 && (
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          {figures.map((f) => (
            <div key={f.label} className="grid">
              <dt className="order-last text-callout text-fg-2">{f.label}</dt>
              <dd className="tabular font-display text-display font-bold">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {recruiters.length > 0 && (
        <p className="text-body">
          <span className="text-fg-2">{t('landing.recruiters')}</span> {recruiters.join(' · ')}
        </p>
      )}
      <p className="text-caption text-fg-3">
        {t('landing.numbersNote')}{' '}
        <a href="/p/outcomes" className="hit font-semibold text-brand-ink hover:underline">
          {t('landing.numbersLink')}
        </a>
      </p>
    </section>
  );
}

/** Below the first screen: three things you can do, each with a crop of the real screen. */
function Below() {
  const { t } = useTranslation();
  return (
    <div className="grid gap-12 pb-12">
      <div className="grid gap-10 lg:grid-cols-3 lg:gap-8">
        {SECTIONS.map((k) => (
          <section key={k} aria-labelledby={`landing-${k}`} className="grid content-start gap-3">
            <h2 id={`landing-${k}`} className="text-headline font-semibold">
              {t(`landing.sections.${k}`)}
            </h2>
            <p className="text-body text-fg-2">{t(`landing.sections.${k}Body`)}</p>
            <div className="overflow-hidden rounded-[var(--radius-md)] ring-1 ring-line">
              <Shot name={k} alt={t(`landing.shots.${k}`)} />
            </div>
          </section>
        ))}
      </div>
      <Outcomes />
    </div>
  );
}

function Footer() {
  const tenant = useTenant();
  const { t } = useTranslation();
  return (
    <p className="flex items-center gap-2 border-t border-line pt-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))] text-caption text-fg-3">
      <ShieldCheck className="size-4 flex-none" aria-hidden />{' '}
      {t('landing.foot', { college: tenant.branding.displayName })}
    </p>
  );
}

function Backdrop() {
  return (
    <>
      <Mesh className="absolute inset-0 size-full saturate-[1.15]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_45%,var(--bg))]" />
    </>
  );
}

/**
 * The landing (prompt 3, U4): the college's crest and name once, an outcome headline, one primary
 * action, a picture of the real product, three things you can do, the college's published numbers,
 * and the privacy promise. Where index.html already drew the frame and headline (lib/first-paint.ts),
 * the page renders into that frame and keeps the headline the browser painted first.
 */
export function LandingPage() {
  const { t, i18n } = useTranslation();
  const [fp, setFp] = useState(() => claimFirstPaint(i18n.language));
  // index.html carries English only: another language drops the frame for good (state adjusted
  // during render, so the app's own frame is in the same commit), and the last hold removes it.
  if (fp && i18n.language !== 'en') setFp(null);
  const portal = fp && i18n.language === 'en' ? fp : null;

  useLayoutEffect(() => (fp ? holdFirstPaint() : undefined), [fp]);
  // The next tap is Join or Sign in: their code downloads while the visitor reads.
  useEffect(() => preloadWhenIdle(['/sign-up', '/sign-in']), []);

  const slots: Record<FirstPaintSlot, ReactNode> = {
    backdrop: <Backdrop />,
    header: <Header />,
    copy: <Copy />,
    figure: <Figure />,
    below: <Below />,
    footer: <Footer />,
  };
  if (portal) return <>{FIRST_PAINT_SLOTS.map((s) => createPortal(slots[s], portal[s], s))}</>;
  return <LandingFrame headline={<Headline a={t('landing.h1a')} b={t('landing.h1b')} />} slots={slots} />;
}
