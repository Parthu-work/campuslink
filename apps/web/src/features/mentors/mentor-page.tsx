import { lazy, Suspense } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PauseCircle, UserX } from 'lucide-react';
import type { MentorCard } from '@campuslink/shared';
import { BackLink } from '../../components/ui/back-link';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { SafetyMenu } from '../../components/layout/safety-menu';
import { api } from '../../lib/api';
import { findCached, hasId } from '../../lib/query-seed';

// The form library and Zod load alongside the mentor's header instead of before it (bundle budget).
const RequestForm = lazy(() => import('./request-form').then((m) => ({ default: m.RequestForm })));

export function MentorPage() {
  const { userId = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
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
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (!q.data)
    return (
      <>
        {back}
        <EmptyState icon={<UserX className="size-6" />} title={t('mentors.notFound')}>
          {t('mentors.notFoundBody')}
        </EmptyState>
      </>
    );
  const m = q.data;
  return (
    <>
      {back}
      <Card className="grid gap-4 p-5">
        <div className="flex items-start gap-4">
          <span className="flex-none" style={{ viewTransitionName: `mentor-${m.userId}` }}>
            <PersonAvatar name={m.name} fileId={m.avatarFileId} size={72} verified />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] leading-tight font-bold">{m.name}</h1>
            {m.headline && <p className="text-fg-2">{m.headline}</p>}
            {(m.jobTitle || m.company) && (
              <p className="text-sm">{[m.jobTitle, m.company].filter(Boolean).join(' · ')}</p>
            )}
          </div>
          <SafetyMenu userId={m.userId} name={m.name} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {m.branch && (
            <Badge>
              {[m.branch, m.gradYear ? t('people.batch', { year: m.gradYear }) : '']
                .filter(Boolean)
                .join(' · ')}
            </Badge>
          )}
          {[...m.topics, ...m.skills].map((x) => (
            <Badge key={x} tone="brand">
              {x}
            </Badge>
          ))}
          {m.languages.map((x) => (
            <Badge key={x}>{x}</Badge>
          ))}
        </div>
        <Link
          to={`/people/${m.userId}`}
          className="justify-self-start text-sm font-semibold text-brand-ink hover:underline"
        >
          {t('mentors.fullProfile')}
        </Link>
      </Card>
      {!m.open && (
        <Card className="flex gap-3 p-4" role="status">
          <PauseCircle className="mt-0.5 size-5 flex-none text-warning" aria-hidden />
          <p className="text-sm">{t('mentors.fullBody')}</p>
        </Card>
      )}
      <Suspense fallback={<Skeleton className="h-96" />}>
        <RequestForm mentor={m} />
      </Suspense>
    </>
  );
}
