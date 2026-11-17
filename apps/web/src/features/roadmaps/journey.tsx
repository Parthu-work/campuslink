import { useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { ChevronDown } from 'lucide-react';
import {
  journeyPhases,
  nextStep,
  type RoadmapCategory,
  type RoadmapNode,
  type RoadmapView,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/misc';
import { StepTrack, type TrackPhase } from '../../components/ui/step-track';
import { useTimeText } from '../../lib/roadmaps';
import { KindIcon } from './kind-icon';

/**
 * Steps as a journey (prompt 3, U3): 3–6 phases of about equal time, each step done, next or
 * upcoming (upcoming steps still open: nothing is locked). Phases a member has finished fold
 * away, so the next steps are near the top of the screen. Drawn from any list of steps, so the
 * editor previews a draft exactly as students will see it.
 */
export function JourneyView({
  nodes,
  category,
  done = new Set(),
  pace = 0,
  onOpen,
  label,
}: {
  nodes: readonly RoadmapNode[];
  category: RoadmapCategory;
  done?: ReadonlySet<string>;
  /** The member's pace in hours a week (0: the default pace). */
  pace?: number;
  onOpen: (id: string) => void;
  label?: string;
}) {
  const { t } = useTranslation();
  const time = useTimeText();
  const [showFinished, setShowFinished] = useState(false);
  const next = done.size < nodes.length ? nextStep(nodes, done)?.id : undefined;
  const phases = journeyPhases(nodes, category).map((p): TrackPhase & { finished: boolean } => ({
    name: t(`roadmaps.phase.${p.key}`),
    finished: p.steps.every((s) => done.has(s.id)),
    steps: p.steps.map((s) => ({
      id: s.id,
      title: s.title || t('roadmaps.editor.untitled'),
      state: done.has(s.id) ? 'done' : s.id === next ? 'next' : 'upcoming',
      meta: (
        <>
          <span>{time(s.estimateHours, pace)}</span>
          {s.needsReview && <span>· {t('roadmaps.needsReview')}</span>}
        </>
      ),
      badge: s.kind === 'project' ? <Badge tone="accent">{t('ui.proof')}</Badge> : undefined,
      icon: <KindIcon kind={s.kind} />,
    })),
  }));
  const finished = phases.filter((p) => p.finished);
  // Fold finished phases only while something is left to do.
  const fold = !showFinished && finished.length > 0 && finished.length < phases.length;
  const shown = fold ? phases.filter((p) => !p.finished) : phases;
  const finishedSteps = finished.reduce((sum, p) => sum + p.steps.length, 0);
  return (
    <div className="grid gap-3">
      {fold && (
        <Button variant="tertiary" className="justify-self-start" onClick={() => setShowFinished(true)}>
          <ChevronDown aria-hidden />
          {t('roadmaps.showFinished', { count: finished.length, steps: finishedSteps })}
        </Button>
      )}
      <StepTrack phases={shown} onOpen={onOpen} label={label ?? t('roadmaps.journey')} />
    </div>
  );
}

/** A published path's journey, with the member's progress and pace. */
export function Journey({ roadmap, onOpen }: { roadmap: RoadmapView; onOpen: (id: string) => void }) {
  return (
    <JourneyView
      nodes={roadmap.content.nodes}
      category={roadmap.category}
      done={new Set(roadmap.myProgress?.done ?? [])}
      pace={roadmap.myProgress?.hoursPerWeek ?? 0}
      onOpen={onOpen}
    />
  );
}
