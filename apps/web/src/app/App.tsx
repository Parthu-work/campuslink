import { useTranslation } from 'react-i18next';
import { APP_NAME, SUPPORTED_LOCALES } from '@campuslink/shared';

const LOCALE_LABELS: Record<(typeof SUPPORTED_LOCALES)[number], string> = { en: 'English', te: 'తెలుగు' };

export function App() {
  const { t, i18n } = useTranslation();
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-4 py-16">
      <p className="text-sm font-semibold tracking-widest text-accent uppercase">{APP_NAME}</p>
      <h1 className="font-display text-4xl leading-tight font-bold text-balance sm:text-6xl">
        {t('shell.headline')}
      </h1>
      <p className="text-lg text-muted">{t('shell.sub')}</p>
      <div role="group" aria-label={t('shell.language')} className="flex gap-2">
        {SUPPORTED_LOCALES.map((lng) => (
          <button
            key={lng}
            type="button"
            aria-pressed={i18n.language === lng}
            onClick={() => void i18n.changeLanguage(lng)}
            className="min-h-11 rounded-full border border-line px-4 text-sm aria-pressed:bg-brand aria-pressed:text-bg"
          >
            {LOCALE_LABELS[lng]}
          </button>
        ))}
      </div>
    </main>
  );
}
