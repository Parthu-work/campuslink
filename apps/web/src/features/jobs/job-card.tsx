import { useTranslation } from 'react-i18next';
import {
  Bookmark,
  BookmarkCheck,
  Building2,
  Clock,
  HandHelping,
  MapPin,
  Sparkles,
  Users,
} from 'lucide-react';
import type { JobView } from '@campuslink/shared';
import { IntentLink } from '../../components/ui/intent-link';
import { Badge, Card } from '../../components/ui/misc';
import { formatRelative } from '../../lib/format';
import { closingSoon, formatSalary, useTrack } from '../../lib/jobs';
import { useCan } from '../../lib/me';
import { cn } from '../../lib/cn';

export function SaveJobButton({ job, className }: { job: JobView; className?: string }) {
  const { t } = useTranslation();
  const canSave = useCan('jobs:save');
  const track = useTrack(job);
  if (!canSave) return null;
  const saved = !!job.track;
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? t('jobs.unsave', { title: job.title }) : t('jobs.save', { title: job.title })}
      onClick={() => track.mutate({ status: saved ? null : 'saved' })}
      className={cn(
        'grid size-10 flex-none place-items-center rounded-full text-fg-2 hover:bg-surface-2 aria-pressed:text-brand-ink',
        className,
      )}
    >
      {saved ? <BookmarkCheck className="size-5" aria-hidden /> : <Bookmark className="size-5" aria-hidden />}
    </button>
  );
}

/** Small facts line: location · mode · type · level. */
export function JobFacts({ job }: { job: JobView }) {
  const { t } = useTranslation();
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-2">
      <span className="inline-flex items-center gap-1">
        <MapPin className="size-3.5" aria-hidden /> {job.location}
      </span>
      {job.mode && <span>· {t(`jobs.mode.${job.mode}`)}</span>}
      <span>· {t(`jobs.type.${job.type}`)}</span>
      {job.level && (
        <span>
          · {job.origin === 'posted' ? '' : `${t('jobs.about')} `}
          {t(`jobs.level.${job.level}`)}
        </span>
      )}
    </p>
  );
}

/** Smart card for Job Radar and lists. */
export function JobCard({ job, compact = false }: { job: JobView; compact?: boolean }) {
  const { t } = useTranslation();
  const soon = closingSoon(job.expiresAt);
  return (
    <Card className={cn('flex h-full flex-col gap-2.5 p-4', compact && 'w-[min(300px,80vw)] flex-none')}>
      <article
        className="flex h-full flex-col gap-2.5"
        aria-labelledby={`job-${job.id}${compact ? '-c' : ''}`}
      >
        <div className="flex items-start gap-3">
          <span
            className="grid size-10 flex-none place-items-center rounded-[var(--radius-md)] bg-surface-2 text-brand-ink"
            aria-hidden
          >
            <Building2 className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3
              id={`job-${job.id}${compact ? '-c' : ''}`}
              className="leading-snug font-semibold"
              // The list card's title morphs into the job page's heading (view transition).
              style={compact ? undefined : { viewTransitionName: `job-${job.id}` }}
            >
              <IntentLink to={`/jobs/${job.id}`} className="hover:underline">
                {job.title}
              </IntentLink>
            </h3>
            <p className="truncate text-sm text-fg-2">{job.company}</p>
          </div>
          <SaveJobButton job={job} />
        </div>
        <JobFacts job={job} />
        <p className="flex flex-wrap gap-1.5">
          {job.freshersOk && (
            <Badge tone="success">
              <Sparkles className="size-3" aria-hidden /> {t('jobs.fresherFriendly')}
            </Badge>
          )}
          {job.referrers > 0 ? (
            <Badge tone="accent">
              <HandHelping className="size-3" aria-hidden /> {t('jobs.canRefer', { count: job.referrers })}
            </Badge>
          ) : (
            job.alumniCount > 0 && (
              <Badge tone="brand">
                <Users className="size-3" aria-hidden /> {t('jobs.alumniHere', { count: job.alumniCount })}
              </Badge>
            )
          )}
          {job.salary && <Badge>{formatSalary(job.salary)}</Badge>}
          {job.track && <Badge tone="brand">{t(`jobs.track.${job.track.status}`)}</Badge>}
        </p>
        {!compact && job.skills.length > 0 && (
          <p className="line-clamp-1 text-xs text-fg-3">{job.skills.slice(0, 6).join(' · ')}</p>
        )}
        <p className="mt-auto flex items-center gap-1 text-xs text-fg-3">
          <Clock className="size-3.5" aria-hidden />
          {soon
            ? t('jobs.closes', { when: formatRelative(job.expiresAt) })
            : t('jobs.posted', { when: formatRelative(job.postedAt) })}
          {job.source && <span className="truncate"> · {job.source.attribution ?? job.source.name}</span>}
        </p>
      </article>
    </Card>
  );
}
