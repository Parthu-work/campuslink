import { useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { ArrowRight, Play } from 'lucide-react';
import { DEFAULT_HOURS_PER_WEEK, nextStep, type RoadmapView } from '@campuslink/shared';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/field';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { Badge } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { ProgressBar } from '../../components/ui/progress';
import { useCan, useMe } from '../../lib/me';
import { formatDay } from '../../lib/format';
import { useRoadmapProgress, useTimeText } from '../../lib/roadmaps';
import { ContentMenu } from '../feed/content-menu';

const PACES = [0, 2, 4, 6, 8, 10, 12, 15, 20, 30, 40];

/**
 * "Your pace: 6 h a week · Change" (prompt 3, U3): one line, a select only while changing it, and
 * the week so far beside it. Without a pace, times are shown at the default and say so.
 */
function PaceControl({ roadmap }: { roadmap: RoadmapView }) {
  const { t } = useTranslation();
  const { goal } = useRoadmapProgress(roadmap);
  const [editing, setEditing] = useState(false);
  const p = roadmap.myProgress;
  if (!p) return null;
  return (
    <div className="grid gap-1">
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={t('roadmaps.paceLabel')}
            size="sm"
            className="w-auto"
            defaultValue={String(p.hoursPerWeek)}
            disabled={goal.isPending}
            onChange={(e) => goal.mutate(Number(e.target.value), { onSuccess: () => setEditing(false) })}
          >
            {PACES.map((h) => (
              <option key={h} value={h}>
                {h === 0 ? t('roadmaps.noPace') : t('roadmaps.paceOption', { count: h })}
              </option>
            ))}
          </Select>
          <Button variant="tertiary" size="sm" onClick={() => setEditing(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
        <p className="flex flex-wrap items-center gap-x-1 text-callout text-fg-2">
          <span>
            {p.hoursPerWeek > 0 ? t('roadmaps.pace', { count: p.hoursPerWeek }) : t('roadmaps.noPace')}
          </span>
          <span aria-hidden>·</span>
          <Button
            variant="tertiary"
            size="sm"
            className="-ml-1 text-brand-ink"
            onClick={() => setEditing(true)}
          >
            {p.hoursPerWeek > 0 ? t('roadmaps.changePace') : t('roadmaps.setPace')}
          </Button>
        </p>
      )}
      {p.hoursPerWeek > 0 && (
        <p className="text-callout text-fg-2" role="status">
          {p.hoursThisWeek >= p.hoursPerWeek
            ? t('roadmaps.onTrackHours', { done: p.hoursThisWeek, goal: p.hoursPerWeek })
            : t('roadmaps.behindHours', { done: p.hoursThisWeek, goal: p.hoursPerWeek })}
        </p>
      )}
      <p className="text-caption text-fg-3">{t('roadmaps.goalHint')}</p>
    </div>
  );
}

/**
 * The top of a career path (prompt 3, U3): its title, what you'll be able to do, and one action:
 * Start this path, or Continue to the next step. Progress and the pace sit under it; everything
 * else (history, editing, stop following, the sources and who reviewed it) is one tap away.
 */
export function PathHeader({
  roadmap: r,
  onOpenStep,
}: {
  roadmap: RoadmapView;
  onOpenStep: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const canProgress = useCan('roadmaps:progress');
  const { goal, unfollow } = useRoadmapProgress(r);
  const time = useTimeText();
  const live = r.status === 'published' && !!r.version;
  const nodes = r.content.nodes;
  const p = r.myProgress;
  const done = new Set(p?.done ?? []);
  const next = done.size < nodes.length ? nextStep(nodes, done) : null;
  const total = nodes.length;
  const pace = p?.hoursPerWeek || DEFAULT_HOURS_PER_WEEK;
  const totalTime = time(
    nodes
      .filter((n) => !done.has(n.id))
      .reduce<[number, number]>((s, n) => [s[0] + n.estimateHours[0], s[1] + n.estimateHours[1]], [0, 0]),
    pace,
  );

  const primary =
    canProgress && live ? (
      p ? (
        next ? (
          <Button variant="primary" onClick={() => onOpenStep(next.id)}>
            {t('roadmaps.continue')} <ArrowRight aria-hidden />
          </Button>
        ) : null
      ) : (
        <Button
          variant="primary"
          loading={goal.isPending}
          onClick={() =>
            // Following starts without a goal (no nudges until the member sets a pace).
            goal.mutate(0, { onSuccess: () => next && onOpenStep(next.id) })
          }
        >
          <Play aria-hidden /> {t('roadmaps.start')}
        </Button>
      )
    ) : null;

  return (
    <header className="grid gap-4">
      <PageHeader
        as="div"
        back={<BackLink to="/roadmaps">{t('roadmaps.pathsTitle')}</BackLink>}
        title={r.content.title}
        subtitle={
          r.content.outcomes[0] ? t('roadmaps.leadsTo', { outcome: r.content.outcomes[0] }) : undefined
        }
        primary={primary}
        actions={
          live ? (
            <ContentMenu
              targetType="roadmap"
              targetId={r.id}
              authorId={r.author?.userId ?? ''}
              authorName={r.author?.name ?? ''}
              isMine={r.author?.userId === me?.id}
              blockable={!!r.author && r.author.userId !== me?.id}
            />
          ) : undefined
        }
        overflow={[
          {
            label: r.canReview ? t('roadmaps.reviewChanges') : t('roadmaps.history'),
            to: `/roadmaps/${r.slug}/history`,
          },
          ...(r.canEdit
            ? [
                {
                  label: r.draft ? t('roadmaps.editDraft') : t('roadmaps.suggestEdit'),
                  to: `/roadmaps/${r.slug}/edit`,
                },
              ]
            : []),
          ...(p ? [{ label: t('roadmaps.unfollow'), onSelect: () => unfollow.mutate(), danger: true }] : []),
        ]}
        about={
          <div className="grid gap-4">
            <p className="text-body text-fg-2">{r.content.summary}</p>
            {r.content.outcomes.length > 1 && (
              <section className="grid gap-1">
                <h3 className="text-headline font-semibold">{t('roadmaps.outcomes')}</h3>
                <ul className="grid list-disc gap-1 pl-5 text-body">
                  {r.content.outcomes.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </section>
            )}
            <div className="flex flex-wrap gap-1.5">
              <Badge>{t(`roadmaps.cat.${r.category}`)}</Badge>
              <Badge>{t('roadmaps.steps', { count: total })}</Badge>
              {r.branches.map((b) => (
                <Badge key={b}>{b}</Badge>
              ))}
              {r.status !== 'published' && <Badge tone="brand">{t(`roadmaps.status.${r.status}`)}</Badge>}
            </div>
            <p className="text-callout text-fg-2">
              {r.fromLibrary
                ? t('roadmaps.byLibrary')
                : r.author
                  ? t('roadmaps.byAuthor', { name: r.author.name })
                  : null}
              {r.lastReviewedAt && (
                <> · {t('roadmaps.lastReviewed', { date: formatDay(r.lastReviewedAt) })}</>
              )}{' '}
              · v{r.version}
            </p>
            {!!r.content.sources.length && (
              <ListSection title={t('roadmaps.roadmapSources')} level={3}>
                {r.content.sources.map((s) => (
                  <ListRow key={s.url} href={s.url} title={s.title} newTabLabel={t('ui.opensNewTab')} />
                ))}
              </ListSection>
            )}
            <p className="text-caption text-fg-3">{t('roadmaps.disclaimer')}</p>
          </div>
        }
      />
      {p ? (
        <div className="grid gap-2">
          <ProgressBar
            value={done.size}
            max={total}
            label={t('roadmaps.progressOf', { title: r.content.title })}
            valueText={t('roadmaps.stepsDone', { done: done.size, total })}
          />
          <p className="text-callout">
            {next
              ? t('roadmaps.stepsDoneNext', { done: done.size, total, title: next.title })
              : t('roadmaps.finished', { total })}
          </p>
          <PaceControl roadmap={r} />
        </div>
      ) : (
        <p className="text-callout text-fg-2">
          {t('roadmaps.pathSize', { count: total, time: totalTime, hours: pace })}
        </p>
      )}
    </header>
  );
}
