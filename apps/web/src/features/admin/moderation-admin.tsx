import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CheckCircle2, ExternalLink, Gavel, Inbox, RotateCcw, ShieldCheck } from 'lucide-react';
import { REMOVAL_REASONS, type ContentTarget, type PersonRef, type RemovalReason } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, Select, Textarea } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { Segmented } from '../../components/ui/tab-nav';
import { api, ApiError } from '../../lib/api';
import { formatRelative } from '../../lib/format';

type Tab = 'reports' | 'items' | 'questions' | 'appeals';
interface Summary {
  reports: number;
  heldItems: number;
  pendingQuestions: number;
  appeals: number;
}
interface ReportRow {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  note: string;
  snapshot: string;
  reporter?: PersonRef;
  subject?: PersonRef;
  createdAt: string;
}
interface HeldItem {
  id: string;
  title: string;
  snippet: string;
  url: string;
  host: string;
  source: { name: string };
  quality: string[];
}
interface PendingQuestion {
  id: string;
  title: string;
  body: string;
  author?: PersonRef;
  createdAt: string;
}
interface AppealRow {
  id: string;
  targetType: ContentTarget;
  targetId: string;
  author?: PersonRef;
  message: string;
  snapshot: string;
  context: Record<string, string>;
  removal: { reason: RemovalReason; note: string; by: string } | null;
  createdAt: string;
}

const CONTENT = new Set(['post', 'comment', 'question', 'answer', 'story']);
const linkFor = (type: string, id: string, ctx: Record<string, string> = {}) =>
  type === 'post'
    ? `/posts/${id}`
    : type === 'question'
      ? `/questions/${id}`
      : ctx.postId
        ? `/posts/${ctx.postId}`
        : ctx.questionId
          ? `/questions/${ctx.questionId}`
          : null;

function useInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['moderation'] });
}

function RemoveDialog({
  target,
  onClose,
}: {
  target: { type: ContentTarget; id: string; reportId?: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const done = useInvalidate();
  const [reason, setReason] = useState<RemovalReason>('spam');
  const [note, setNote] = useState('');
  const remove = useMutation({
    mutationFn: () =>
      api.post('/admin/moderation/actions', {
        targetType: target?.type,
        targetId: target?.id,
        action: 'remove',
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(target?.reportId ? { reportId: target.reportId } : {}),
      }),
    onSuccess: () => {
      toast.success(t('mod.removed'));
      setNote('');
      done();
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={t('mod.removeTitle')}
      description={t('mod.removeBody')}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          remove.mutate();
        }}
      >
        <Field label={t('safety.reason')}>
          {({ id }) => (
            <Select id={id} value={reason} onChange={(e) => setReason(e.target.value as RemovalReason)}>
              {REMOVAL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`mod.reasons.${r}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('mod.noteToAuthor')} hint={t('mod.noteToAuthorHint')}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="danger" loading={remove.isPending}>
            {t('mod.remove')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Snapshot({ text }: { text: string }) {
  return (
    <blockquote className="max-h-40 overflow-y-auto rounded-[var(--radius-sm)] border-l-4 border-line-strong bg-surface-2 p-3 text-sm whitespace-pre-wrap">
      {text}
    </blockquote>
  );
}

function Reports() {
  const { t } = useTranslation();
  const done = useInvalidate();
  const [removing, setRemoving] = useState<{ type: ContentTarget; id: string; reportId: string } | null>(
    null,
  );
  const q = useQuery({
    queryKey: ['moderation', 'reports'],
    queryFn: () => api.get<ReportRow[]>('/admin/reports?status=open'),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => api.post(`/admin/reports/${id}/resolve`, { outcome: 'dismissed' }),
    onSuccess: done,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (!q.data?.length) return <EmptyState icon={<Inbox className="size-6" />} title={t('mod.noReports')} />;
  return (
    <>
      <ul className="grid gap-3">
        {q.data.map((r) => {
          const href = linkFor(r.targetType, r.targetId);
          return (
            <li key={r.id}>
              <Card className="grid gap-2 p-4">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone="warning">{t(`content.${r.targetType}`)}</Badge>
                  <b>{t(`safety.reasons.${r.reason}`)}</b>
                  <span className="text-fg-3">
                    {t('mod.reportedBy', {
                      name: r.reporter?.name ?? '?',
                      when: formatRelative(r.createdAt),
                    })}
                  </span>
                </p>
                {r.subject && <p className="text-sm text-fg-2">{t('mod.about', { name: r.subject.name })}</p>}
                {r.note && <p className="text-sm">“{r.note}”</p>}
                {r.snapshot && <Snapshot text={r.snapshot} />}
                <div className="flex flex-wrap gap-2">
                  {href && (
                    <Link
                      to={href}
                      className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-brand-ink hover:underline"
                    >
                      {t('mod.view')} <ExternalLink className="size-3.5" aria-hidden />
                    </Link>
                  )}
                  <span className="ml-auto flex gap-2">
                    <Button
                      size="sm"
                      loading={dismiss.isPending && dismiss.variables === r.id}
                      onClick={() => dismiss.mutate(r.id)}
                    >
                      {t('mod.dismiss')}
                    </Button>
                    {CONTENT.has(r.targetType) && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() =>
                          setRemoving({ type: r.targetType as ContentTarget, id: r.targetId, reportId: r.id })
                        }
                      >
                        <Ban className="size-4" aria-hidden /> {t('mod.remove')}
                      </Button>
                    )}
                  </span>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
      <RemoveDialog target={removing} onClose={() => setRemoving(null)} />
    </>
  );
}

function HeldItems() {
  const { t } = useTranslation();
  const done = useInvalidate();
  const q = useQuery({
    queryKey: ['moderation', 'items'],
    queryFn: () => api.get<HeldItem[]>('/admin/moderation/items'),
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'publish' | 'reject' }) =>
      api.post(`/admin/moderation/items/${id}/decision`, { decision }),
    onSuccess: done,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (!q.data?.length)
    return <EmptyState icon={<ShieldCheck className="size-6" />} title={t('mod.noHeld')} />;
  return (
    <ul className="grid gap-3">
      {q.data.map((i) => (
        <li key={i.id}>
          <Card className="grid gap-2 p-4">
            <p className="flex flex-wrap gap-1.5 text-xs text-fg-3">
              {i.source.name} ·{' '}
              {i.quality.map((x) => (
                <Badge key={x} tone="warning">
                  {t(`mod.quality.${x}`, { defaultValue: x })}
                </Badge>
              ))}
            </p>
            <b>{i.title}</b>
            {i.snippet && <p className="text-sm text-fg-2">{i.snippet}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={i.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-sm font-semibold text-brand-ink hover:underline"
              >
                {i.host}
              </a>
              <span className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => decide.mutate({ id: i.id, decision: 'reject' })}>
                  {t('admin.reject')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => decide.mutate({ id: i.id, decision: 'publish' })}
                >
                  {t('mod.publish')}
                </Button>
              </span>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function PendingQuestions() {
  const { t } = useTranslation();
  const done = useInvalidate();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState<RemovalReason>('off_topic');
  const q = useQuery({
    queryKey: ['moderation', 'questions'],
    queryFn: () => api.get<PendingQuestion[]>('/admin/moderation/questions'),
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      api.post(
        `/admin/moderation/questions/${id}/decision`,
        decision === 'reject' ? { decision, reason } : { decision },
      ),
    onSuccess: (_d, v) => {
      toast.success(v.decision === 'approve' ? t('mod.approvedToast') : t('mod.rejectedToast'));
      setRejecting(null);
      done();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (!q.data?.length)
    return <EmptyState icon={<CheckCircle2 className="size-6" />} title={t('mod.noQuestions')} />;
  return (
    <>
      <ul className="grid gap-3">
        {q.data.map((x) => (
          <li key={x.id}>
            <Card className="grid gap-2 p-4">
              <p className="text-xs text-fg-3">
                {t('mod.askedBy', { name: x.author?.name ?? '?', when: formatRelative(x.createdAt) })}
              </p>
              <b>{x.title}</b>
              {x.body && <p className="text-sm whitespace-pre-wrap text-fg-2">{x.body}</p>}
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={() => setRejecting(x.id)}>
                  {t('admin.reject')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={decide.isPending && decide.variables.id === x.id}
                  onClick={() => decide.mutate({ id: x.id, decision: 'approve' })}
                >
                  {t('admin.approve')}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <Dialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={t('mod.rejectQuestion')}
        description={t('mod.rejectQuestionBody')}
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (rejecting) decide.mutate({ id: rejecting, decision: 'reject' });
          }}
        >
          <Field label={t('safety.reason')}>
            {({ id }) => (
              <Select id={id} value={reason} onChange={(e) => setReason(e.target.value as RemovalReason)}>
                {REMOVAL_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`mod.reasons.${r}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setRejecting(null)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="danger" loading={decide.isPending}>
              {t('admin.reject')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function Appeals() {
  const { t } = useTranslation();
  const done = useInvalidate();
  const q = useQuery({
    queryKey: ['moderation', 'appeals'],
    queryFn: () => api.get<AppealRow[]>('/admin/moderation/appeals'),
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'uphold' | 'reverse' }) =>
      api.post(`/admin/moderation/appeals/${id}/decision`, { decision }),
    onSuccess: () => {
      toast.success(t('mod.appealDecided'));
      done();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (!q.data?.length) return <EmptyState icon={<Gavel className="size-6" />} title={t('mod.noAppeals')} />;
  return (
    <ul className="grid gap-3">
      {q.data.map((a) => {
        const href = linkFor(a.targetType, a.targetId, a.context);
        return (
          <li key={a.id}>
            <Card className="grid gap-2 p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="warning">{t(`content.${a.targetType}`)}</Badge>
                {a.removal && <b>{t(`mod.reasons.${a.removal.reason}`)}</b>}
                <span className="text-fg-3">
                  {t('mod.appealBy', { name: a.author?.name ?? '?', when: formatRelative(a.createdAt) })}
                </span>
              </p>
              {a.snapshot && <Snapshot text={a.snapshot} />}
              <p className="text-sm">
                <span className="font-semibold">{t('mod.authorSays')}</span> “{a.message}”
              </p>
              {a.removal?.note && (
                <p className="text-sm text-fg-2">{t('mod.removalNote', { note: a.removal.note })}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {href && (
                  <Link to={href} className="text-sm font-semibold text-brand-ink hover:underline">
                    {t('mod.view')}
                  </Link>
                )}
                <span className="ml-auto flex gap-2">
                  <Button size="sm" onClick={() => decide.mutate({ id: a.id, decision: 'uphold' })}>
                    {t('mod.uphold')}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => decide.mutate({ id: a.id, decision: 'reverse' })}
                  >
                    <RotateCcw className="size-4" aria-hidden /> {t('mod.reverse')}
                  </Button>
                </span>
              </div>
              <p className="text-xs text-fg-3">{t('mod.secondPair')}</p>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/** Moderation queue: reports, held automated items, questions waiting for approval, appeals. */
export function ModerationAdmin() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('reports');
  const s = useQuery({
    queryKey: ['moderation', 'summary'],
    queryFn: () => api.get<Summary>('/admin/moderation/summary'),
    refetchInterval: 60_000,
  });
  const n = (k: keyof Summary) => (s.data?.[k] ? ` (${s.data[k]})` : '');
  return (
    <div className="grid gap-4">
      <p className="text-fg-2">{t('mod.intro')}</p>
      <Segmented
        label={t('mod.queue')}
        value={tab}
        onChange={setTab}
        options={[
          ['reports', `${t('mod.tabs.reports')}${n('reports')}`],
          ['questions', `${t('mod.tabs.questions')}${n('pendingQuestions')}`],
          ['items', `${t('mod.tabs.items')}${n('heldItems')}`],
          ['appeals', `${t('mod.tabs.appeals')}${n('appeals')}`],
        ]}
      />
      {tab === 'reports' && <Reports />}
      {tab === 'items' && <HeldItems />}
      {tab === 'questions' && <PendingQuestions />}
      {tab === 'appeals' && <Appeals />}
    </div>
  );
}
