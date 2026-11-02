import { useTranslation } from '../../i18n/react';
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
import { accentOf } from '../../lib/accent';
import { pop } from '../../lib/celebrate';

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
      onClick={(e) => {
        if (!saved) pop(e.currentTarget);
        track.mutate({ status: saved ? null : 'saved' });
      }}
      className={cn(
        'react-pop grid size-11 flex-none place-items-center rounded-full text-fg-2 transition-[scale] duration-[var(--dur-fast)] ease-snappy hover:bg-hover active:scale-90 aria-pressed:text-brand-ink',
        className,
      )}
    >
      {saved ? (
        <BookmarkCheck className="size-5 fill-current" aria-hidden />
      ) : (
        <Bookmark className="size-5" aria-hidden />
      )}
    </button>
  );
}

/** Small facts line: location · mode · type · level. */
export function JobFacts({ job }: { job: JobView }) {
  const { t } = useTranslation();
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-2">
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

/**
 * The company's initials in its own accent: a stand-in for a logo, since listings carry none
 * (we never fetch or guess logos).
 */
export function CompanyMark({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const n = accentOf(name);
  const initials = name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <span
      aria-hidden
      className={cn(
        'grid flex-none place-items-center rounded-[var(--radius-md)] font-display font-bold',
        size === 'lg' ? 'size-14 text-title' : 'size-11 text-body',
      )}
      style={{ background: `var(--subject-${n}-surface)`, color: `var(--subject-${n}-ink)` }}
    >
      {initials || <Building2 className="size-5" />}
    </span>
  );
}

/** Smart card for Job Radar and lists. */
export function JobCard({ job, compact = false }: { job: JobView; compact?: boolean }) {
  const { t } = useTranslation();
  const soon = closingSoon(job.expiresAt);
  return (
    <Card
      variant="interactive"
      className={cn('flex h-full flex-col gap-2.5 p-4', compact && 'w-[min(300px,80vw)] flex-none')}
    >
      <article
        className="flex h-full flex-col gap-2.5"
        aria-labelledby={`job-${job.id}${compact ? '-c' : ''}`}
      >
        <div className="flex items-start gap-3">
          <CompanyMark name={job.company} />
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
            <p className="truncate text-meta text-fg-2">{job.company}</p>
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
          <p className="line-clamp-1 text-caption text-fg-3">{job.skills.slice(0, 6).join(' · ')}</p>
        )}
        <p className="mt-auto flex items-center gap-1 text-caption text-fg-3">
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
