import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  BriefcaseBusiness,
  CalendarClock,
  Compass,
  HeartHandshake,
  Lock,
  Newspaper,
  Orbit,
  ShieldCheck,
} from 'lucide-react';
import type { BookingView, ImpactView } from '@campuslink/shared';
import { Card, Skeleton } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { api } from '../../lib/api';
import { useCan } from '../../lib/me';
import { formatDay, formatTime } from '../../lib/format';
import { buttonVariants } from '../../components/ui/button-variants';
import { useMe } from '../../lib/me';
import { useTenant } from '../../lib/tenant-context';

function NextSession() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['bookings', 'upcoming'],
    queryFn: () => api.get<BookingView[]>('/bookings?when=upcoming'),
  });
  const b = q.data?.[0];
  if (q.isLoading) return <Skeleton className="h-24" />;
  return (
    <Card className="flex items-center gap-3 p-4">
      {b ? (
        <>
          <PersonAvatar
            name={(b.role === 'mentor' ? b.mentee : b.mentor).name}
            fileId={(b.role === 'mentor' ? b.mentee : b.mentor).avatarFileId}
          />
          <div className="min-w-0 flex-1">
            <p className="eyebrow">{t('home.nextSession')}</p>
            <b className="block truncate">
              {t(`session.type.${b.sessionType}`)} · {(b.role === 'mentor' ? b.mentee : b.mentor).name}
            </b>
            <p className="text-sm text-fg-2">
              {formatDay(b.start)}, {formatTime(b.start)}
            </p>
          </div>
        </>
      ) : (
        <>
          <CalendarClock className="size-6 flex-none text-accent-ink" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-fg-2">{t('home.noSession')}</p>
        </>
      )}
      <Link
        to="/sessions"
        className="rounded-full px-3 py-2 text-sm font-semibold text-brand-ink hover:bg-surface-2"
      >
        {t('nav.sessions')}
      </Link>
    </Card>
  );
}

function ImpactTeaser() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['impact'], queryFn: () => api.get<ImpactView>('/me/mentor/impact') });
  if (!q.data) return null;
  return (
    <Link to="/mentor" className="block rounded-[var(--radius-md)]">
      <Card className="flex items-center gap-3 p-4 transition-colors hover:border-line-strong">
        <HeartHandshake className="size-6 flex-none text-accent-ink" aria-hidden />
        <div className="min-w-0 flex-1">
          <b className="block">{t('mentor.helped', { count: q.data.helpedThisMonth })}</b>
          {q.data.pendingRequests > 0 && (
            <p className="text-sm text-fg-2">{t('mentor.pending', { count: q.data.pendingRequests })}</p>
          )}
        </div>
      </Card>
    </Link>
  );
}

/** Home: honest about what exists. Feed content arrives in Phase 4. */
export function HomePage() {
  const { t } = useTranslation();
  const tenant = useTenant();
  const { data: me, isLoading } = useMe();
  const canRequest = useCan('mentorship:request');
  const canMentor = useCan('mentorship:mentor');
  const upcoming = [
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
            <Link
              to="/verify"
              className={buttonVariants({ variant: 'primary', size: 'sm', className: 'mt-3' })}
            >
              {t('home.verifyCta')}
            </Link>
          </div>
        </Card>
      )}
      {canRequest && (
        <section aria-label={t('home.mentorship')} className="grid gap-3">
          <NextSession />
          {canMentor && <ImpactTeaser />}
          <Link to="/mentors" className="block rounded-[var(--radius-md)]">
            <Card className="flex items-center gap-3 p-4 transition-colors hover:border-line-strong">
              <Compass className="size-6 flex-none text-brand-ink" aria-hidden />
              <div className="min-w-0 flex-1">
                <b className="block">{t('home.findMentor')}</b>
                <p className="text-sm text-fg-2">{t('home.findMentorBody')}</p>
              </div>
            </Card>
          </Link>
        </section>
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
