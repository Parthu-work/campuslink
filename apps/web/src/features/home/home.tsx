import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BriefcaseBusiness, Lock, MessagesSquare, Newspaper, Orbit, ShieldCheck, Users } from 'lucide-react';
import { Card, Skeleton } from '../../components/ui/misc';
import { useMe } from '../../lib/me';
import { useTenant } from '../../lib/tenant-context';

/** Phase 1 home: honest about what exists. Feed content arrives in Phase 4. */
export function HomePage() {
  const { t } = useTranslation();
  const tenant = useTenant();
  const { data: me, isLoading } = useMe();
  const upcoming = [
    { key: 'people', icon: Users },
    { key: 'mentorship', icon: MessagesSquare },
    { key: 'feed', icon: Newspaper },
    { key: 'jobs', icon: BriefcaseBusiness },
    { key: 'galaxy', icon: Orbit },
  ] as const;
  return (
    <>
      <h1 className="text-[clamp(26px,4vw,34px)] font-bold">
        {isLoading || !me ? (
          <Skeleton className="h-9 w-56" />
        ) : (
          t('home.greeting', { name: me.name.split(' ')[0] })
        )}
      </h1>
      {me && !me.verified && (
        <Card
          className="flex gap-3 border-[color-mix(in_srgb,var(--warning)_45%,var(--line))] p-4"
          role="status"
        >
          <Lock className="mt-0.5 size-5 flex-none text-warning" aria-hidden />
          <div>
            <h2 className="font-semibold">{t('home.unverifiedTitle')}</h2>
            <p className="text-sm text-fg-2">{t('home.unverifiedBody')}</p>
          </div>
        </Card>
      )}
      <section aria-labelledby="coming" className="grid gap-3">
        <h2 id="coming" className="text-lg font-semibold">
          {t('home.comingTitle', { college: tenant.branding.shortName })}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {upcoming.map(({ key, icon: Icon }) => (
            <li key={key}>
              <Card className="flex h-full items-start gap-3 p-4">
                <span
                  className="grid size-10 flex-none place-items-center rounded-xl bg-surface-2 text-accent-ink"
                  aria-hidden
                >
                  <Icon className="size-5" />
                </span>
                <p className="text-sm">{t(`home.phase.${key}`)}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>
      <Card className="flex items-center gap-3 p-4">
        <ShieldCheck className="size-6 flex-none text-success" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t('home.secure')}</h2>
          <p className="text-sm text-fg-2">{t('home.secureBody')}</p>
        </div>
        <Link
          to="/settings"
          className="rounded-full px-3 py-2 text-sm font-semibold text-brand-ink hover:bg-surface-2"
        >
          {t('nav.settings')}
        </Link>
      </Card>
    </>
  );
}
