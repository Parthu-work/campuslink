import { lazy, Suspense, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { useQuery } from '@tanstack/react-query';
import { Map as MapIcon } from 'lucide-react';
import { EmptyState, Skeleton } from '../../components/ui/misc';
import { Segmented } from '../../components/ui/tab-nav';
import { useUrlOverlay } from '../../lib/use-url-overlay';
import { roadmap } from '../../lib/queries';
import { defaultPathView, rememberPathView, type PathView } from '../../lib/roadmaps';
import { SCREEN } from '../../lib/query-client';
import { PathHeader } from './path-header';
import { Journey } from './journey';
import { StepSheet } from './step-sheet';
import { LazySeniorsOnPath } from '../mentors/lazy-seniors';
import { LazyDrivesOnPath } from '../placements/lazy-drives';
import { useCan } from '../../lib/me';
import { useFeature } from '../../lib/tenant-context';

// The map of the whole graph loads only when a member chooses it.
const GraphView = lazy(() => import('./graph-view').then((m) => ({ default: m.GraphView })));

/**
 * A career path (prompt 3, U3): the header with one action (Start or Continue), the steps as a
 * journey in phases, and the open step in a sheet. On a phone the first screen holds the header
 * and the next steps; nothing explains the screen above them.
 */
export function RoadmapPage() {
  const canAsk = useCan('mentorship:request');
  const canSeeDrives = useCan('placements:view');
  const placementsOn = useFeature('placements');
  const canDrives = canSeeDrives && placementsOn;
  const { slug = '' } = useParams();
  const { t } = useTranslation();
  const [view, setView] = useState<PathView>(defaultPathView);
  // The open step lives in the URL (?step=), so Back closes it and a step can be linked (audit J5).
  const step = useUrlOverlay('step');
  const q = useQuery({ ...roadmap(slug), ...SCREEN });
  if (q.isLoading)
    return (
      <div className="grid gap-4" aria-hidden>
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-11 w-40 rounded-md" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  const r = q.data;
  if (!r)
    return (
      <EmptyState icon={<MapIcon />} title={t('roadmaps.notFound')}>
        <Link to="/roadmaps" className="text-brand-ink underline">
          {t('roadmaps.back')}
        </Link>
      </EmptyState>
    );
  return (
    <div className="grid gap-5">
      <PathHeader roadmap={r} onOpenStep={step.open} />
      {r.draft && (
        <p
          className="rounded-[var(--radius-md)] border border-line bg-brand-surface p-3 text-callout"
          role="note"
        >
          {t(`roadmaps.draftBanner.${r.draft.status}`, { version: r.draft.version })}
          {r.draft.reviewNote && (
            <span className="block text-fg-2">
              {t('roadmaps.reviewNote')}: {r.draft.reviewNote}
            </span>
          )}
        </p>
      )}
      <div className="grid gap-3">
        <Segmented
          label={t('roadmaps.viewAs')}
          value={view}
          className="justify-self-end"
          onChange={(v) => {
            setView(v);
            rememberPathView(v);
          }}
          options={[
            ['journey', t('roadmaps.journeyView')],
            ['map', t('roadmaps.map')],
          ]}
        />
        {view === 'map' ? (
          <Suspense fallback={<Skeleton className="h-80" />}>
            <GraphView roadmap={r} onOpen={step.open} />
          </Suspense>
        ) : (
          <Journey roadmap={r} onOpen={step.open} />
        )}
      </div>
      {/* People on the path (prompt 3, U6): seniors who work as what it leads to. */}
      {canAsk && r.status === 'published' && r.content.outcomes[0] && (
        <LazySeniorsOnPath role={r.content.outcomes[0]} fallback={null} />
      )}
      {/* Outcomes (prompt 3, U7): open drives for a role the path leads to. */}
      {canDrives && r.status === 'published' && r.content.outcomes.length > 0 && (
        <LazyDrivesOnPath roles={r.content.outcomes} fallback={null} />
      )}
      <StepSheet roadmap={r} nodeId={step.value} onClose={step.close} onOpen={step.open} />
    </div>
  );
}
