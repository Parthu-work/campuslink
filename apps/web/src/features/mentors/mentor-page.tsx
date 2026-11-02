import { lazy, Suspense } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Clock, PauseCircle, Send } from 'lucide-react';
import type { MentorCard } from '@campuslink/shared';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { Sheet } from '../../components/ui/dialog';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { SafetyMenu } from '../../components/layout/safety-menu';
import { api } from '../../lib/api';
import { coverOf } from '../../lib/accent';
import { findCached, hasId } from '../../lib/query-seed';
import { useUrlOverlay } from '../../lib/use-url-overlay';
import { SCREEN } from '../../lib/query-client';
import { firstName } from '../../lib/names';
import { MentorStatsLine } from './mentor-stats';
import { MentorReviews } from './mentor-reviews';

// The form library and Zod load with the sheet, not before the mentor's header (bundle budget).
const RequestForm = lazy(() => import('./request-form').then((m) => ({ default: m.RequestForm })));

/**
 * A mentor's page (§8.4): a cover in their own accent, a large face, what they do and where, their
 * batch, the sessions they offer, and one primary action. Requesting opens a sheet (a bottom sheet
 * on phones) that Back closes.
 */
export function MentorPage() {
  const { userId = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sheet = useUrlOverlay('ask');
  const q = useQuery({
    ...SCREEN,
    queryKey: ['mentor', userId],
    queryFn: () => api.get<MentorCard & { timezone: string }>(`/mentors/${userId}`),
    enabled: /^[a-f0-9]{24}$/.test(userId),
    // The tile the member tapped (Alumni Match or Browse) draws the header at once.
    placeholderData: () => {
      const tile = findCached(
        qc,
        [['match'], ['mentors']],
        hasId<MentorCard>('userId', userId, ['sessionTypes', 'headline']),
      );
      return tile ? { ...tile, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : undefined;
    },
    retry: false,
  });
  const back = <BackLink to="/mentors">{t('mentors.back')}</BackLink>;
  if (q.isLoading)
    return (
      <div className="mx-auto grid w-full max-w-[760px] gap-4">
        {back}
        <Skeleton className="h-80 rounded-[var(--radius-xl)]" />
      </div>
    );
  if (!q.data)
    return (
      <div className="mx-auto grid w-full max-w-[760px] gap-4">
        {back}
        <EmptyState art={<Illustration kind="people" />} title={t('mentors.notFound')}>
          {t('mentors.notFoundBody')}
        </EmptyState>
      </div>
    );
  const m = q.data;
  const role = [m.jobTitle, m.company].filter(Boolean);
  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-4">
      {back}
      <Card variant="raised" className="overflow-hidden">
        <div aria-hidden className="h-24 sm:h-32" style={{ background: coverOf(m.name) }} />
        <div className="grid gap-4 px-5 pb-5 sm:px-6 sm:pb-6">
          <div className="-mt-12 flex items-end justify-between gap-3 sm:-mt-14">
            <span
              className="flex-none rounded-full ring-4 ring-surface-1"
              style={{ viewTransitionName: `mentor-${m.userId}` }}
            >
              <PersonAvatar name={m.name} fileId={m.avatarFileId} size={96} verified />
            </span>
            <SafetyMenu userId={m.userId} name={m.name} />
          </div>
          <div className="grid gap-1">
            <h1 className="text-headline leading-tight font-bold">{m.name}</h1>
            {role.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-1.5 text-lead text-fg-2">
                {m.jobTitle && <span>{m.jobTitle}</span>}
                {m.jobTitle && m.company && <span aria-hidden>·</span>}
                {m.company && (
                  <span className="inline-flex items-center gap-1 font-semibold text-fg">
                    {m.company}
                    {m.companyVerified && (
                      <BadgeCheck className="size-4 text-success" aria-label={t('people.companyVerified')} />
                    )}
                  </span>
                )}
              </p>
            )}
            {(m.branch || m.gradYear) && (
              <p className="text-meta text-fg-3">
                {[m.branch, m.gradYear ? t('people.batch', { year: m.gradYear }) : '']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
          {m.headline && <p className="max-w-[62ch] text-body">{m.headline}</p>}
          {m.stats && <MentorStatsLine stats={m.stats} layout="list" />}
          {(m.topics.length > 0 || m.skills.length > 0 || m.languages.length > 0) && (
            <ul className="flex flex-wrap gap-1.5" aria-label={t('mentors.topics')}>
              {[...m.topics, ...m.skills].map((x) => (
                <li key={x}>
                  <Badge tone="brand">{x}</Badge>
                </li>
              ))}
              {m.languages.map((x) => (
                <li key={x}>
                  <Badge>{x}</Badge>
                </li>
              ))}
            </ul>
          )}
          <section aria-labelledby="offers" className="grid gap-2">
            <h2 id="offers" className="eyebrow">
              {t('mentors.offers')}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {m.sessionTypes.map((s) => (
                <li
                  key={s.type}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line-strong px-3 text-meta font-semibold"
                >
                  {t(`session.type.${s.type}`)}
                  <span className="inline-flex items-center gap-1 font-normal text-fg-2">
                    <Clock className="size-3.5" aria-hidden />
                    {s.durationMin ? t('session.minutes', { n: s.durationMin }) : t('session.async')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          {!m.open && (
            <p
              className="flex gap-3 rounded-[var(--radius-md)] bg-warning-surface p-3.5 text-meta"
              role="status"
            >
              <PauseCircle className="mt-0.5 size-5 flex-none text-warning" aria-hidden />
              {t('mentors.fullBody')}
            </p>
          )}
          <div className="grid gap-2 sm:flex sm:items-center">
            <Button variant="primary" size="lg" disabled={!m.open} onClick={() => sheet.open('request')}>
              <Send className="size-5" aria-hidden /> {t('mentors.requestCta')}
            </Button>
            <Link
              to={`/people/${m.userId}`}
              className="inline-flex min-h-12 items-center justify-center rounded-full px-5 text-body font-semibold text-brand-ink hover:bg-hover"
            >
              {t('mentors.fullProfile')}
            </Link>
          </div>
        </div>
      </Card>
      <MentorReviews mentorId={m.userId} />
      <Sheet
        open={sheet.value === 'request'}
        onOpenChange={(o) => !o && sheet.close()}
        title={t('request.title', { name: firstName(m.name) })}
        history={false}
      >
        <Suspense fallback={<Skeleton className="h-96" />}>
          <RequestForm mentor={m} />
        </Suspense>
      </Sheet>
    </div>
  );
}
