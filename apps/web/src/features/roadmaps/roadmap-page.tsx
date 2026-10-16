import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CircleDashed,
  ExternalLink,
  Flag,
  History,
  Minus,
  Pencil,
  Plus,
  Scan,
  Target,
  Trash2,
} from 'lucide-react';
import {
  topoOrder,
  type NodeCommentView,
  type RoadmapNode,
  type RoadmapView,
  type SourceRef,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Dialog } from '../../components/ui/dialog';
import { Select, Textarea } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { Segmented } from '../../components/ui/tab-nav';
import { api, ApiError } from '../../lib/api';
import { useCan, useMe } from '../../lib/me';
import { cn } from '../../lib/cn';
import { formatDay, formatRelative } from '../../lib/format';
import {
  NODE_H,
  NODE_W,
  defaultRoadmapView,
  layoutGraph,
  nextSteps,
  rememberRoadmapView,
  totalHours,
  useRoadmapProgress,
} from '../../lib/roadmaps';
import { ContentMenu } from '../feed/content-menu';

function Links({ items, label }: { items: SourceRef[]; label: string }) {
  if (!items.length) return null;
  return (
    <div className="grid gap-1">
      <h4 className="text-xs font-semibold tracking-wide text-fg-3 uppercase">{label}</h4>
      <ul className="grid gap-1">
        {items.map((s) => (
          <li key={s.url}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-start gap-1.5 text-sm text-brand-ink underline-offset-2 hover:underline"
            >
              <ExternalLink className="mt-0.5 size-3.5 flex-none" aria-hidden />
              <span>{s.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function KindBadge({ kind }: { kind: RoadmapNode['kind'] }) {
  const { t } = useTranslation();
  return (
    <Badge
      tone={
        kind === 'project'
          ? 'accent'
          : kind === 'exam'
            ? 'warning'
            : kind === 'milestone'
              ? 'brand'
              : 'neutral'
      }
    >
      {t(`roadmaps.kind.${kind}`)}
    </Badge>
  );
}

function Comments({ roadmap, nodeId }: { roadmap: RoadmapView; nodeId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const canReview = useCan('roadmaps:review');
  const key = ['roadmap', roadmap.id, 'comments'];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<NodeCommentView[]>(`/roadmaps/${roadmap.id}/comments`),
  });
  const add = useMutation({
    mutationFn: () => api.post<NodeCommentView>(`/roadmaps/${roadmap.id}/comments`, { nodeId, body }),
    onSuccess: () => {
      setBody('');
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/roadmap-comments/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
  const rows = (q.data ?? []).filter((c) => c.nodeId === nodeId);
  return (
    <section aria-label={t('roadmaps.comments')} className="grid gap-2 border-t border-line pt-3">
      <h4 className="text-sm font-semibold">{t('roadmaps.comments')}</h4>
      <p className="text-xs text-fg-3">{t('roadmaps.commentsHint')}</p>
      <ul className="grid gap-2">
        {rows.map((c) => (
          <li key={c.id} className="rounded-[var(--radius-sm)] bg-surface-2 p-2.5 text-sm">
            <div className="flex items-center justify-between gap-2 text-xs text-fg-3">
              <span>
                <span className="font-semibold text-fg-2">{c.author.name}</span> · v{c.version} ·{' '}
                {formatRelative(c.createdAt)}
              </span>
              {(c.isMine || canReview) && (
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded-full hover:bg-surface-3"
                  aria-label={t('roadmaps.deleteComment')}
                  onClick={() => del.mutate(c.id)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              )}
            </div>
            <p className="whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim().length >= 2) add.mutate();
        }}
      >
        <label className="sr-only" htmlFor={`comment-${nodeId}`}>
          {t('roadmaps.addComment')}
        </label>
        <Textarea
          id={`comment-${nodeId}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder={t('roadmaps.addComment')}
        />
        <Button
          type="submit"
          size="sm"
          loading={add.isPending}
          disabled={body.trim().length < 2}
          className="justify-self-end"
        >
          {t('roadmaps.postComment')}
        </Button>
      </form>
    </section>
  );
}

function NodePanel({
  roadmap,
  node,
  onClose,
}: {
  roadmap: RoadmapView;
  node: RoadmapNode | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const canWrite = useCan('roadmaps:write');
  const canProgress = useCan('roadmaps:progress') && roadmap.status === 'published' && !!roadmap.version;
  const { toggle } = useRoadmapProgress(roadmap);
  if (!node) return null;
  const done = !!roadmap.myProgress?.done.includes(node.id);
  const prereqs = roadmap.content.nodes.filter((n) => node.prerequisites.includes(n.id));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={node.title}>
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-1.5">
          <KindBadge kind={node.kind} />
          <Badge>
            {t('roadmaps.aboutHours', { min: node.estimateHours[0], max: node.estimateHours[1] })}
          </Badge>
          {done && (
            <Badge tone="success">
              <Check className="size-3" aria-hidden /> {t('roadmaps.done')}
            </Badge>
          )}
        </div>
        {node.needsReview && (
          <p className="flex gap-2 rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] p-2.5 text-sm text-fg-2">
            <AlertTriangle className="mt-0.5 size-4 flex-none text-warning" aria-hidden />
            {t('roadmaps.needsReviewNote')}
          </p>
        )}
        <p className="text-fg-2">{node.summary}</p>
        {!!prereqs.length && (
          <p className="text-sm text-fg-3">
            {t('roadmaps.after')}: {prereqs.map((p) => p.title).join(', ')}
          </p>
        )}
        {node.proof && (
          <div className="rounded-[var(--radius-sm)] border border-line p-2.5 text-sm">
            <span className="font-semibold">{t('roadmaps.proof')}:</span> {node.proof}
          </div>
        )}
        <Links items={node.resources} label={t('roadmaps.resources')} />
        <Links items={node.sources} label={t('roadmaps.sources')} />
        {canProgress && (
          <Button
            variant={done ? 'secondary' : 'primary'}
            loading={toggle.isPending}
            onClick={() => toggle.mutate({ nodeId: node.id, done: !done })}
          >
            {done ? (
              <CircleDashed className="size-4" aria-hidden />
            ) : (
              <Check className="size-4" aria-hidden />
            )}
            {done ? t('roadmaps.markNotDone') : t('roadmaps.markDone')}
          </Button>
        )}
        {canWrite && <Comments roadmap={roadmap} nodeId={node.id} />}
      </div>
    </Dialog>
  );
}

function Graph({ roadmap, onOpen }: { roadmap: RoadmapView; onOpen: (n: RoadmapNode) => void }) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const { placed, width, height } = useMemo(
    () => layoutGraph(roadmap.content.nodes),
    [roadmap.content.nodes],
  );
  const done = new Set(roadmap.myProgress?.done ?? []);
  const pos = new Map(placed.map((p) => [p.node.id, p]));
  const pad = 24;
  const w = width + pad * 2;
  const h = height + pad * 2;
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex justify-end gap-1 border-b border-line p-1.5">
        <button
          type="button"
          aria-label={t('roadmaps.zoomOut')}
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
          className="grid size-9 place-items-center rounded-full hover:bg-surface-2"
        >
          <Minus className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t('roadmaps.zoomFit')}
          onClick={() => setZoom(1)}
          className="grid size-9 place-items-center rounded-full hover:bg-surface-2"
        >
          <Scan className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t('roadmaps.zoomIn')}
          onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
          className="grid size-9 place-items-center rounded-full hover:bg-surface-2"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
      {/* Native scrolling pans (touch, trackpad, keyboard); buttons zoom. */}
      <div
        className="max-h-[70vh] overflow-auto overscroll-contain"
        tabIndex={0}
        aria-label={t('roadmaps.graphLabel')}
        role="region"
      >
        <svg
          width={w * zoom}
          height={h * zoom}
          viewBox={`${-pad} ${-pad} ${w} ${h}`}
          className="block"
          role="list"
          aria-label={t('roadmaps.graphLabel')}
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--line-strong)" />
            </marker>
          </defs>
          {placed.flatMap((p) =>
            p.node.prerequisites.flatMap((pre) => {
              const a = pos.get(pre);
              if (!a) return [];
              const x1 = a.x + NODE_W;
              const y1 = a.y + NODE_H / 2;
              const x2 = p.x;
              const y2 = p.y + NODE_H / 2;
              const mx = (x1 + x2) / 2;
              return [
                <path
                  key={`${pre}-${p.node.id}`}
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2 - 4} ${y2}`}
                  fill="none"
                  stroke={done.has(pre) ? 'var(--success)' : 'var(--line-strong)'}
                  strokeWidth={2}
                  markerEnd="url(#arrow)"
                  aria-hidden
                />,
              ];
            }),
          )}
          {placed.map((p) => {
            const isDone = done.has(p.node.id);
            return (
              <g key={p.node.id} role="listitem" transform={`translate(${p.x} ${p.y})`}>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`${p.node.title}, ${t(`roadmaps.kind.${p.node.kind}`)}${isDone ? `, ${t('roadmaps.done')}` : ''}${p.node.needsReview ? `, ${t('roadmaps.needsReview')}` : ''}`}
                  onClick={() => onOpen(p.node)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen(p.node);
                    }
                  }}
                  className="group cursor-pointer outline-none"
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={14}
                    fill={
                      isDone ? 'color-mix(in srgb, var(--success) 18%, var(--surface-1))' : 'var(--surface-1)'
                    }
                    stroke={
                      isDone
                        ? 'var(--success)'
                        : p.node.kind === 'project'
                          ? 'var(--accent)'
                          : 'var(--line-strong)'
                    }
                    strokeWidth={p.node.kind === 'project' || isDone ? 2.5 : 1.5}
                    strokeDasharray={p.node.needsReview ? '6 4' : undefined}
                    className="transition-[stroke] group-hover:stroke-[var(--brand)]"
                  />
                  <rect
                    x={-4}
                    y={-4}
                    width={NODE_W + 8}
                    height={NODE_H + 8}
                    rx={17}
                    fill="none"
                    stroke="var(--fg)"
                    strokeWidth={2.5}
                    className="opacity-0 group-focus-visible:opacity-100"
                  />
                  <text x={14} y={26} className="fill-[var(--fg)] text-[14px] font-semibold">
                    {p.node.title.length > 24 ? `${p.node.title.slice(0, 23)}…` : p.node.title}
                  </text>
                  <text x={14} y={46} className="fill-[var(--fg-3)] text-[12px]">
                    {t(`roadmaps.kind.${p.node.kind}`)} ·{' '}
                    {t('roadmaps.aboutHours', { min: p.node.estimateHours[0], max: p.node.estimateHours[1] })}
                  </text>
                  {isDone && (
                    <g transform={`translate(${NODE_W - 26} 10)`} aria-hidden>
                      <circle cx={8} cy={8} r={9} fill="var(--success)" />
                      <path
                        d="M4 8.5 L7 11.5 L12.5 5.5"
                        stroke="var(--surface-1)"
                        strokeWidth={2}
                        fill="none"
                      />
                    </g>
                  )}
                </g>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="border-t border-line px-3 py-2 text-xs text-fg-3">{t('roadmaps.graphLegend')}</p>
    </Card>
  );
}

function StepList({ roadmap, onOpen }: { roadmap: RoadmapView; onOpen: (n: RoadmapNode) => void }) {
  const { t } = useTranslation();
  const done = new Set(roadmap.myProgress?.done ?? []);
  const ordered = topoOrder(roadmap.content.nodes);
  return (
    <ol className="grid gap-2">
      {ordered.map((n, i) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => onOpen(n)}
            className={cn(
              'grid w-full grid-cols-[32px_1fr] items-start gap-3 rounded-[var(--radius-md)] border border-line bg-surface-1 p-3 text-left hover:border-line-strong',
              done.has(n.id) && 'border-[color-mix(in_srgb,var(--success)_50%,transparent)]',
            )}
          >
            <span
              className={cn(
                'grid size-8 place-items-center rounded-full font-mono text-sm',
                done.has(n.id) ? 'bg-success text-[var(--surface-1)]' : 'bg-surface-2 text-fg-2',
              )}
              aria-hidden
            >
              {done.has(n.id) ? <Check className="size-4" /> : i + 1}
            </span>
            <span className="grid gap-1">
              <span className="font-semibold">
                {n.title}
                {done.has(n.id) && <span className="sr-only">, {t('roadmaps.done')}</span>}
              </span>
              <span className="line-clamp-2 text-sm text-fg-2">{n.summary}</span>
              <span className="flex flex-wrap gap-1.5">
                <KindBadge kind={n.kind} />
                <Badge>
                  {t('roadmaps.aboutHours', { min: n.estimateHours[0], max: n.estimateHours[1] })}
                </Badge>
                {n.needsReview && <Badge tone="warning">{t('roadmaps.needsReview')}</Badge>}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function ProgressCard({ roadmap }: { roadmap: RoadmapView }) {
  const { t } = useTranslation();
  const { goal, unfollow } = useRoadmapProgress(roadmap);
  const p = roadmap.myProgress;
  const total = roadmap.content.nodes.length;
  const doneCount = p?.done.length ?? 0;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const next = nextSteps(roadmap.content.nodes, new Set(p?.done ?? [])).slice(0, 3);
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Target className="size-5 text-brand-ink" aria-hidden /> {t('roadmaps.yourProgress')}
        </h2>
        <span className="font-mono text-sm text-fg-2">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={t('roadmaps.yourProgress')}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div className="h-full rounded-full bg-success transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-fg-2">{t('roadmaps.doneOf', { done: doneCount, total })}</p>
      <label className="grid gap-1 text-sm">
        <span className="font-semibold">{t('roadmaps.weeklyGoal')}</span>
        <Select
          value={String(p?.nodesPerWeek ?? 0)}
          onChange={(e) => goal.mutate(Number(e.target.value))}
          disabled={goal.isPending}
        >
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? t('roadmaps.noGoal') : t('roadmaps.perWeek', { count: n })}
            </option>
          ))}
        </Select>
        <span className="text-xs text-fg-3">{t('roadmaps.goalHint')}</span>
      </label>
      {!!p && p.nodesPerWeek > 0 && (
        <p className="text-sm" role="status">
          {p.doneThisWeek >= p.nodesPerWeek
            ? t('roadmaps.onTrack')
            : t('roadmaps.thisWeek', { done: p.doneThisWeek, goal: p.nodesPerWeek })}
        </p>
      )}
      {!!next.length && doneCount < total && (
        <div className="grid gap-1">
          <h3 className="text-xs font-semibold tracking-wide text-fg-3 uppercase">{t('roadmaps.next')}</h3>
          <ul className="list-disc pl-5 text-sm">
            {next.map((n) => (
              <li key={n.id}>{n.title}</li>
            ))}
          </ul>
        </div>
      )}
      {p && (
        <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => unfollow.mutate()}>
          {t('roadmaps.unfollow')}
        </Button>
      )}
    </Card>
  );
}

export function RoadmapPage() {
  const { slug = '' } = useParams();
  const { t } = useTranslation();
  const canProgress = useCan('roadmaps:progress');
  const { data: me } = useMe();
  const [view, setView] = useState<'graph' | 'list'>(defaultRoadmapView);
  const [open, setOpen] = useState<RoadmapNode | null>(null);
  const q = useQuery({
    queryKey: ['roadmap', slug],
    queryFn: () => api.get<RoadmapView>(`/roadmaps/${slug}`),
  });
  if (q.isLoading)
    return (
      <div className="grid gap-3" aria-hidden>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-24" />
        <Skeleton className="h-80" />
      </div>
    );
  const r = q.data;
  if (!r)
    return (
      <EmptyState icon={<BookOpen className="size-6" />} title={t('roadmaps.notFound')}>
        <Link to="/roadmaps" className="text-brand-ink underline">
          {t('roadmaps.back')}
        </Link>
      </EmptyState>
    );
  const [lo, hi] = totalHours(r.content.nodes);
  const live = r.status === 'published';
  // Keep the open panel in sync with fresh data (progress toggles).
  const openNode = open ? (r.content.nodes.find((n) => n.id === open.id) ?? null) : null;
  return (
    <div className="grid gap-5">
      <nav aria-label={t('common.breadcrumb', { defaultValue: 'Breadcrumb' })} className="text-sm text-fg-3">
        <Link to="/roadmaps" className="hover:text-fg">
          {t('roadmaps.title')}
        </Link>{' '}
        / {t(`roadmaps.cat.${r.category}`)}
      </nav>
      <header className="grid gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-[clamp(26px,4vw,34px)] leading-tight font-bold">{r.content.title}</h1>
          <div className="flex flex-wrap gap-2">
            <Link to={`/roadmaps/${r.slug}/history`} className={buttonVariants({ size: 'sm' })}>
              <History className="size-4" aria-hidden />{' '}
              {r.canReview ? t('roadmaps.reviewChanges') : t('roadmaps.history')}
            </Link>
            {r.canEdit && (
              <Link
                to={`/roadmaps/${r.slug}/edit`}
                className={buttonVariants({ size: 'sm', variant: 'primary' })}
              >
                <Pencil className="size-4" aria-hidden />{' '}
                {r.draft ? t('roadmaps.editDraft') : t('roadmaps.suggestEdit')}
              </Link>
            )}
            {live && (
              <ContentMenu
                targetType="roadmap"
                targetId={r.id}
                authorId={r.author?.userId ?? ''}
                authorName={r.author?.name ?? ''}
                isMine={r.author?.userId === me?.id}
                blockable={!!r.author && r.author.userId !== me?.id}
              />
            )}
          </div>
        </div>
        <p className="max-w-[70ch] text-fg-2">{r.content.summary}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge>{t(`roadmaps.cat.${r.category}`)}</Badge>
          <Badge>{t('roadmaps.steps', { count: r.content.nodes.length })}</Badge>
          <Badge>{t('roadmaps.aboutHoursTotal', { min: lo, max: hi })}</Badge>
          {r.branches.map((b) => (
            <Badge key={b}>{b}</Badge>
          ))}
          {r.status !== 'published' && <Badge tone="brand">{t(`roadmaps.status.${r.status}`)}</Badge>}
        </div>
        <p className="text-xs text-fg-3">
          {r.fromLibrary
            ? t('roadmaps.byLibrary')
            : r.author
              ? t('roadmaps.byAuthor', { name: r.author.name })
              : null}
          {r.lastReviewedAt && <> · {t('roadmaps.lastReviewed', { date: formatDay(r.lastReviewedAt) })}</>} ·
          v{r.version}
        </p>
        {!!r.content.outcomes.length && (
          <p className="text-sm">
            <span className="font-semibold">{t('roadmaps.outcomes')}:</span> {r.content.outcomes.join(' · ')}
          </p>
        )}
      </header>

      {r.draft && (
        <Card className="flex flex-wrap items-center justify-between gap-2 border-[color-mix(in_srgb,var(--brand)_40%,transparent)] p-3">
          <p className="text-sm">
            <Flag className="mr-1 inline size-4 text-brand-ink" aria-hidden />
            {t(`roadmaps.draftBanner.${r.draft.status}`, { version: r.draft.version })}
            {r.draft.reviewNote && (
              <span className="block text-fg-2">
                {t('roadmaps.reviewNote')}: {r.draft.reviewNote}
              </span>
            )}
          </p>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="grid min-w-0 content-start gap-3">
          <Segmented
            label={t('roadmaps.viewAs')}
            value={view}
            className="max-w-xs"
            onChange={(v) => {
              setView(v);
              rememberRoadmapView(v);
            }}
            options={[
              ['graph', t('roadmaps.graph')],
              ['list', t('roadmaps.list')],
            ]}
          />
          {view === 'graph' ? (
            <Graph roadmap={r} onOpen={setOpen} />
          ) : (
            <StepList roadmap={r} onOpen={setOpen} />
          )}
        </div>
        <aside className="grid content-start gap-3">
          {canProgress && live && <ProgressCard roadmap={r} />}
          <Card className="grid gap-2 p-4">
            <Links items={r.content.sources} label={t('roadmaps.roadmapSources')} />
            <p className="text-xs text-fg-3">{t('roadmaps.disclaimer')}</p>
          </Card>
        </aside>
      </div>
      <NodePanel roadmap={r} node={openNode} onClose={() => setOpen(null)} />
    </div>
  );
}
