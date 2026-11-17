import { useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Check, CircleCheck, Trash2 } from 'lucide-react';
import { nextStep, type NodeCommentView, type RoadmapView, type SourceRef } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Sheet } from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/field';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { Badge } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useCan } from '../../lib/me';
import { celebrate } from '../../lib/celebrate';
import { formatRelative } from '../../lib/format';
import { useRoadmapProgress, useTimeText } from '../../lib/roadmaps';
import { KindIcon } from './kind-icon';

/** Links to other sites as rows: the title, the site it is on, and that it opens a new tab. */
function LinkRows({ items, title }: { items: SourceRef[]; title: string }) {
  const { t } = useTranslation();
  if (!items.length) return null;
  const site = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };
  return (
    <ListSection title={title} level={3}>
      {items.map((s) => (
        <ListRow
          key={s.url}
          href={s.url}
          title={s.title}
          meta={site(s.url)}
          newTabLabel={t('ui.opensNewTab')}
        />
      ))}
    </ListSection>
  );
}

/** "How you'll know you're done", one item per line or clause of the step's proof. */
const proofItems = (proof: string) =>
  proof
    .split(/\n|;\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

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
    <section aria-label={t('roadmaps.comments')} className="grid gap-2 border-t border-line pt-4">
      <h3 className="text-headline font-semibold">{t('roadmaps.comments')}</h3>
      <p className="text-callout text-fg-2">{t('roadmaps.commentsHint')}</p>
      {!!rows.length && (
        <ListSection>
          {rows.map((c) => (
            <ListRow
              key={c.id}
              title={<span className="font-normal whitespace-pre-wrap">{c.body}</span>}
              meta={`${c.author.name} · v${c.version} · ${formatRelative(c.createdAt)}`}
              trailing={
                c.isMine || canReview ? (
                  <Button
                    variant="tertiary"
                    size="icon"
                    aria-label={t('roadmaps.deleteComment')}
                    onClick={() => del.mutate(c.id)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                ) : undefined
              }
            />
          ))}
        </ListSection>
      )}
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

/**
 * One step (prompt 3, U3): what it is and why, how you'll know you're done, where to learn it,
 * the sources, and Mark done (with Undo) and Next step in the footer, always in reach. A bottom
 * sheet on phones and a panel from the right on wider screens; the open step is in the URL
 * (`?step=`), so Back closes it and a step can be linked.
 */
export function StepSheet({
  roadmap,
  nodeId,
  onClose,
  onOpen,
}: {
  roadmap: RoadmapView;
  nodeId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const canWrite = useCan('roadmaps:write');
  const canProgress = useCan('roadmaps:progress') && roadmap.status === 'published' && !!roadmap.version;
  const { toggle } = useRoadmapProgress(roadmap);
  const time = useTimeText();
  const node = nodeId ? roadmap.content.nodes.find((n) => n.id === nodeId) : undefined;
  if (!node) return null;
  const doneIds = new Set(roadmap.myProgress?.done ?? []);
  const done = doneIds.has(node.id);
  const pace = roadmap.myProgress?.hoursPerWeek ?? 0;
  const prereqs = roadmap.content.nodes.filter((n) => node.prerequisites.includes(n.id));
  // The step after this one, counting this one as done.
  const after = nextStep(roadmap.content.nodes, new Set([...doneIds, node.id]));
  const proof = proofItems(node.proof);

  const markDone = (from: HTMLElement) =>
    toggle.mutate(
      { nodeId: node.id, done: true },
      {
        onSuccess: () => {
          // Finishing a step is a moment worth marking (ADR 0008); undoing one is quiet.
          celebrate(from);
          toast.undo(t('roadmaps.markedDone', { title: node.title }), t('ui.undo'), () =>
            toggle.mutate({ nodeId: node.id, done: false }),
          );
        },
      },
    );

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={node.title}
      history={false}
      footer={
        canProgress ? (
          <div className="flex w-full flex-wrap gap-2 [&>*]:flex-1">
            {done ? (
              <Button
                variant="secondary"
                loading={toggle.isPending}
                onClick={() => toggle.mutate({ nodeId: node.id, done: false })}
              >
                {t('roadmaps.markNotDone')}
              </Button>
            ) : (
              <Button variant="primary" loading={toggle.isPending} onClick={(e) => markDone(e.currentTarget)}>
                <Check aria-hidden /> {t('roadmaps.markDone')}
              </Button>
            )}
            {after && after.id !== node.id && (
              <Button variant="secondary" onClick={() => onOpen(after.id)}>
                {t('roadmaps.nextStep')} <ArrowRight aria-hidden />
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-callout text-fg-2">
          <span className="flex items-center gap-1.5">
            <KindIcon kind={node.kind} /> {t(`roadmaps.kind.${node.kind}`)}
          </span>
          <span>{time(node.estimateHours, pace)}</span>
          {done && (
            <Badge tone="success">
              <Check className="size-3" aria-hidden /> {t('roadmaps.done')}
            </Badge>
          )}
        </div>
        {node.needsReview && (
          <p className="flex gap-2 rounded-[var(--radius-sm)] bg-warning-surface p-3 text-callout text-warning-ink">
            <AlertTriangle className="mt-0.5 size-4 flex-none" aria-hidden />
            {t('roadmaps.needsReviewNote')}
          </p>
        )}
        <section className="grid gap-1.5">
          <h3 className="text-headline font-semibold">{t('roadmaps.what')}</h3>
          <p className="text-body text-fg-2">{node.summary}</p>
          {!!prereqs.length && (
            <p className="text-callout text-fg-2">
              {t('roadmaps.after')}: {prereqs.map((p) => p.title).join(', ')}
            </p>
          )}
        </section>
        {!!proof.length && (
          <section className="grid gap-1.5">
            <h3 className="text-headline font-semibold">{t('roadmaps.doneWhen')}</h3>
            <ul className="grid gap-1.5">
              {proof.map((p) => (
                <li key={p} className="flex gap-2 text-body">
                  <CircleCheck
                    className={
                      done ? 'mt-0.5 size-5 flex-none text-success-ink' : 'mt-0.5 size-5 flex-none text-fg-3'
                    }
                    aria-hidden
                  />
                  {p}
                </li>
              ))}
            </ul>
          </section>
        )}
        <LinkRows items={node.resources} title={t('roadmaps.resources')} />
        <LinkRows items={node.sources} title={t('roadmaps.sources')} />
        {canWrite && <Comments roadmap={roadmap} nodeId={node.id} />}
      </div>
    </Sheet>
  );
}
