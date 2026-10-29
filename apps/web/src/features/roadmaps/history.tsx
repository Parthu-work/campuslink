import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { Check, GitCompare, History, MessageSquareWarning } from 'lucide-react';
import type { RoadmapContent, RoadmapView, VersionView } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Field, Textarea } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { BackLink } from '../../components/ui/back-link';
import { api, ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatDay } from '../../lib/format';
import { diffContent } from '../../lib/roadmaps';
import { SCREEN } from '../../lib/query-client';

type VersionDetail = VersionView & { content: RoadmapContent; problems: string[] };

function Diff({ before, after }: { before: RoadmapContent | null; after: RoadmapContent }) {
  const { t } = useTranslation();
  if (!before)
    return <p className="text-meta text-fg-2">{t('roadmaps.firstVersion', { count: after.nodes.length })}</p>;
  const d = diffContent(before, after);
  if (!d.roadmap.length && !d.nodes.length)
    return <p className="text-meta text-fg-2">{t('roadmaps.noChanges')}</p>;
  return (
    <div className="grid gap-2">
      {!!d.roadmap.length && (
        <p className="text-meta">
          <span className="font-semibold">{t('roadmaps.diff.roadmap')}:</span>{' '}
          {d.roadmap.map((f) => t(`roadmaps.field.${f}`)).join(', ')}
        </p>
      )}
      <ul className="grid gap-1.5">
        {d.nodes.map((c) => (
          <li
            key={`${c.kind}-${c.node.id}`}
            className={cn(
              'rounded-[var(--radius-sm)] border-l-4 bg-surface-2 px-3 py-2 text-meta',
              c.kind === 'added' && 'border-success',
              c.kind === 'removed' && 'border-danger',
              c.kind === 'changed' && 'border-warning',
            )}
          >
            <span className="font-semibold">{t(`roadmaps.diff.${c.kind}`)}</span>: {c.node.title}
            {c.kind === 'changed' && (
              <span className="text-fg-2"> ({c.fields.map((f) => t(`roadmaps.field.${f}`)).join(', ')})</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewForm({ roadmap }: { roadmap: RoadmapView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const review = useMutation({
    mutationFn: (decision: 'approve' | 'request_changes') =>
      api.post<RoadmapView>(`/roadmaps/${roadmap.id}/review`, { decision, note }),
    onSuccess: (r, decision) => {
      toast.success(decision === 'approve' ? t('roadmaps.approved') : t('roadmaps.changesRequested'));
      qc.setQueryData(['roadmap', roadmap.slug], r);
      void qc.invalidateQueries({ queryKey: ['roadmap', roadmap.id] });
      void qc.invalidateQueries({ queryKey: ['roadmaps'] });
      setNote('');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <Card className="grid gap-3 p-4">
      <h2 className="font-display text-title font-semibold">{t('roadmaps.review.decide')}</h2>
      <Field label={t('roadmaps.review.note')} hint={t('roadmaps.review.noteHint')}>
        {(f) => (
          <Textarea
            id={f.id}
            aria-describedby={f.describedBy}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            rows={3}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          loading={review.isPending && review.variables === 'approve'}
          onClick={() => review.mutate('approve')}
        >
          <Check className="size-4" aria-hidden /> {t('roadmaps.review.approve')}
        </Button>
        <Button
          loading={review.isPending && review.variables === 'request_changes'}
          disabled={note.trim().length < 5}
          onClick={() => review.mutate('request_changes')}
        >
          <MessageSquareWarning className="size-4" aria-hidden /> {t('roadmaps.review.requestChanges')}
        </Button>
      </div>
    </Card>
  );
}

export function RoadmapHistoryPage() {
  const { slug = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const roadmap = useQuery({
    ...SCREEN,
    queryKey: ['roadmap', slug],
    queryFn: () => api.get<RoadmapView>(`/roadmaps/${slug}`),
  });
  const id = roadmap.data?.id;
  const versions = useQuery({
    ...SCREEN,
    queryKey: ['roadmap', id, 'versions'],
    queryFn: () => api.get<VersionView[]>(`/roadmaps/${id ?? ''}/versions`),
    enabled: !!id,
  });
  const list = versions.data ?? [];
  const [picked, setPicked] = useState<number | null>(null);
  const selected = picked ?? list[0]?.version ?? null;
  const prev = selected
    ? (list.find((v) => v.version < selected && v.status !== 'draft' && v.status !== 'submitted')?.version ??
      null)
    : null;
  const detail = (v: number | null) => ({
    queryKey: ['roadmap', id, 'version', v],
    queryFn: () => api.get<VersionDetail>(`/roadmaps/${id ?? ''}/versions/${v ?? 0}`),
    enabled: !!id && v !== null,
  });
  const cur = useQuery(detail(selected));
  const before = useQuery(detail(prev));
  if (roadmap.isLoading) return <Skeleton className="h-64" />;
  const r = roadmap.data;
  if (!r) return <EmptyState icon={<History className="size-6" />} title={t('roadmaps.notFound')} />;
  const reviewing = r.canReview && r.draft?.status === 'submitted' && selected === r.draft.version;
  const submitDraft = async () => {
    try {
      await api.post(`/roadmaps/${r.id}/submit`, {});
      toast.success(t('roadmaps.submitted'));
      navigate(`/roadmaps/${r.slug}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
    }
  };
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <BackLink to={`/roadmaps/${r.slug}`}>{r.title}</BackLink>
        <PageHeader icon={<GitCompare />} title={t('roadmaps.history')} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <ol className="grid content-start gap-2" aria-label={t('roadmaps.versions')}>
          {list.map((v) => (
            <li key={v.version}>
              <button
                type="button"
                aria-pressed={v.version === selected}
                onClick={() => setPicked(v.version)}
                className="grid w-full gap-1 rounded-[var(--radius-md)] border border-line bg-surface-1 p-3 text-left aria-pressed:border-brand"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold">v{v.version}</span>
                  <Badge
                    tone={
                      v.status === 'published' ? 'success' : v.status === 'superseded' ? 'neutral' : 'brand'
                    }
                  >
                    {t(`roadmaps.vstatus.${v.status}`)}
                  </Badge>
                </span>
                {v.changeNote && <span className="line-clamp-2 text-meta text-fg-2">{v.changeNote}</span>}
                <span className="text-caption text-fg-3">
                  {v.author ? v.author.name : t('roadmaps.libraryAuthor')} · {formatDay(v.createdAt)}
                  {v.reviewer && ` · ${t('roadmaps.reviewedBy', { name: v.reviewer.name })}`}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="grid content-start gap-3">
          {cur.data ? (
            <Card className="grid gap-3 p-4">
              <h2 className="font-display text-title font-semibold">
                {t('roadmaps.changesIn', { version: cur.data.version })}
              </h2>
              {cur.data.reviewNote && (
                <p className="text-meta">
                  <span className="font-semibold">{t('roadmaps.reviewNote')}:</span> {cur.data.reviewNote}
                </p>
              )}
              <Diff before={before.data?.content ?? null} after={cur.data.content} />
              {(cur.data.status === 'draft' || cur.data.status === 'submitted') && (
                <div className="grid gap-1">
                  <h3 className="text-meta font-semibold">{t('roadmaps.checklist')}</h3>
                  {cur.data.problems.length ? (
                    <ul className="list-disc pl-5 text-meta text-warning">
                      {cur.data.problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-meta text-success">{t('roadmaps.checklistOk')}</p>
                  )}
                </div>
              )}
              {cur.data.status === 'draft' && r.canEdit && (
                <Button variant="primary" className="justify-self-start" onClick={() => void submitDraft()}>
                  {t('roadmaps.submit')}
                </Button>
              )}
            </Card>
          ) : (
            <Skeleton className="h-40" />
          )}
          {reviewing && <ReviewForm roadmap={r} />}
          {r.draft?.status === 'submitted' && !r.canReview && r.draft.version === selected && (
            <p className="text-meta text-fg-2">{t('roadmaps.awaitingOther')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
