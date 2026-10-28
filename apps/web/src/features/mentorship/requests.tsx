import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { Inbox, MessageSquare, Video } from 'lucide-react';
import {
  DECLINE_TEMPLATES,
  isBookable,
  type DeclineTemplate,
  type RequestView,
  type SlotsView,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Dialog } from '../../components/ui/dialog';
import { Field, Textarea } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { SlotPicker } from '../../components/ui/slot-picker';
import { Segmented } from '../../components/ui/tab-nav';
import { SafetyMenu } from '../../components/layout/safety-menu';
import { api, ApiError } from '../../lib/api';
import { celebrate, firstSighting } from '../../lib/celebrate';
import { useCan } from '../../lib/me';
import { formatDateTime, formatRelative, newIdempotencyKey } from '../../lib/format';
import { SCREEN } from '../../lib/query-client';
import { cn } from '../../lib/cn';
import { firstName } from '../../lib/names';

const STATUS_TONE = {
  pending: 'warning',
  accepted: 'success',
  declined: 'neutral',
  withdrawn: 'neutral',
  expired: 'neutral',
} as const;

function useRespond(id: string) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [key] = useState(newIdempotencyKey);
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.postOnce<RequestView>(`/mentorship/requests/${id}/respond`, body, key),
    // Optimistic: the card resolves at once and rolls back if the answer fails (audit ST-4, B7).
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ['requests'] });
      const before = qc.getQueriesData<RequestView[]>({ queryKey: ['requests'] });
      const status: RequestView['status'] = body.action === 'decline' ? 'declined' : 'accepted';
      qc.setQueriesData<RequestView[]>({ queryKey: ['requests'] }, (list) =>
        list?.map((r) => (r.id === id ? { ...r, status } : r)),
      );
      return { before };
    },
    onSuccess: (r) => {
      if (r.status === 'accepted') celebrate();
      toast.success(
        r.status === 'declined'
          ? t('request.declinedToast', { name: firstName(r.mentee.name) })
          : t('request.acceptedToast', { name: firstName(r.mentee.name) }),
      );
      void qc.invalidateQueries({ queryKey: ['requests'] });
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (e, _body, ctx) => {
      for (const [k, v] of ctx?.before ?? []) qc.setQueryData(k, v);
      toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
    },
  });
}

function OtherTimeDialog({
  r,
  open,
  onOpenChange,
}: {
  r: RequestView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const [slot, setSlot] = useState<string | null>(null);
  const slots = useQuery({
    queryKey: ['request-slots', r.id],
    queryFn: () => api.get<SlotsView>(`/mentorship/requests/${r.id}/slots?days=14`),
    enabled: open,
  });
  const respond = useRespond(r.id);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('request.otherTimeTitle')}
      description={t('request.otherTimeBody', { name: r.mentee.name })}
    >
      <SlotPicker
        label={t('request.pickTime')}
        slots={slots.data?.slots ?? []}
        value={slot}
        onChange={setSlot}
        loading={slots.isLoading}
      />
      <div className="flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
        <Button
          variant="primary"
          disabled={!slot}
          loading={respond.isPending}
          onClick={() =>
            slot &&
            respond.mutate(
              { action: 'accept_other', slotStart: slot },
              { onSuccess: () => onOpenChange(false) },
            )
          }
        >
          {t('request.acceptAt')}
        </Button>
      </div>
    </Dialog>
  );
}

function DeclineDialog({
  r,
  open,
  onOpenChange,
}: {
  r: RequestView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const [template, setTemplate] = useState<DeclineTemplate>('fully_booked');
  const [note, setNote] = useState('');
  const respond = useRespond(r.id);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('request.declineTitle')}
      description={t('request.declineBody')}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-meta font-semibold">{t('request.reply')}</legend>
        {DECLINE_TEMPLATES.map((tpl) => (
          <label
            key={tpl}
            className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border border-line-strong p-3 has-[:checked]:border-brand"
          >
            <input
              type="radio"
              name={`decline-${r.id}`}
              checked={template === tpl}
              onChange={() => setTemplate(tpl)}
              className="mt-1 size-4 accent-[var(--brand)]"
            />
            <span className="text-meta">
              {t(`request.decline.${tpl}`, { name: firstName(r.mentee.name) })}
            </span>
          </label>
        ))}
      </fieldset>
      <Field label={t('request.addNote')}>
        {({ id }) => (
          <Textarea id={id} maxLength={300} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
        <Button
          variant="primary"
          loading={respond.isPending}
          onClick={() =>
            respond.mutate(
              { action: 'decline', template, ...(note.trim() ? { note: note.trim() } : {}) },
              { onSuccess: () => onOpenChange(false) },
            )
          }
        >
          {t('request.sendReply')}
        </Button>
      </div>
    </Dialog>
  );
}

/** Accepted in the last three days: worth a second look (and a celebration, once). */
const justAccepted = (r: RequestView) =>
  r.status === 'accepted' && !!r.respondedAt && Date.now() - Date.parse(r.respondedAt) < 3 * 86_400_000;

function RequestCard({ r, box }: { r: RequestView; box: 'received' | 'sent' }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<'other' | 'decline' | null>(null);
  const other = box === 'received' ? r.mentee : r.mentor;
  const respond = useRespond(r.id);
  const withdraw = useMutation({
    mutationFn: () => api.post(`/mentorship/requests/${r.id}/withdraw`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['requests'] }),
  });
  const pending = r.status === 'pending';
  return (
    <Card variant={justAccepted(r) ? 'featured' : 'raised'} className="grid gap-3 p-4">
      <div className="flex items-start gap-3">
        <PersonAvatar name={other.name} fileId={other.avatarFileId} />
        <div className="min-w-0 flex-1">
          <b className="block truncate">{other.name}</b>
          <p className="text-meta text-fg-2">
            {t(`session.type.${r.sessionType}`)}
            {r.slotStart ? ` · ${formatDateTime(r.slotStart)}` : ''}
          </p>
        </div>
        <Badge tone={STATUS_TONE[r.status]}>{t(`request.status.${r.status}`)}</Badge>
        <SafetyMenu userId={other.userId} name={other.name} target={{ type: 'request', id: r.id }} />
      </div>
      {r.message ? (
        <p className="rounded-[var(--radius-md)] bg-surface-2 px-4 py-3 text-body whitespace-pre-line">
          {r.message}
        </p>
      ) : (
        <dl className="grid gap-2 text-meta">
          {(['goal', 'background', 'need'] as const).map((f) => (
            <div key={f}>
              <dt className="eyebrow">{t(`request.label.${f}`)}</dt>
              <dd className="whitespace-pre-line">{r[f]}</dd>
            </div>
          ))}
        </dl>
      )}
      {r.status === 'declined' && r.declineTemplate && (
        <p className="rounded-[var(--radius-sm)] bg-surface-2 p-3 text-meta">
          {t(`request.decline.${r.declineTemplate}`, { name: firstName(r.mentee.name) })}
          {r.declineNote && <span className="mt-1 block text-fg-2">“{r.declineNote}”</span>}
        </p>
      )}
      <p className="text-caption text-fg-3">
        {t('request.sentAgo', { when: formatRelative(r.createdAt) })}
        {pending && ` · ${t('request.expires', { when: formatRelative(r.expiresAt) })}`}
      </p>
      <div className="flex flex-wrap gap-2">
        {box === 'received' && pending && (
          <>
            <Button
              variant="primary"
              loading={respond.isPending}
              onClick={() => respond.mutate({ action: 'accept' })}
            >
              {t('request.accept')}
            </Button>
            {isBookable(r.sessionType) && (
              <Button onClick={() => setDialog('other')}>{t('request.otherTime')}</Button>
            )}
            <Button variant="ghost" onClick={() => setDialog('decline')}>
              {t('request.declineAction')}
            </Button>
          </>
        )}
        {box === 'sent' && pending && (
          <Button variant="ghost" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
            {t('request.withdraw')}
          </Button>
        )}
        {r.status === 'accepted' && r.conversationId && (
          <Link
            to={`/messages/${r.conversationId}`}
            className={buttonVariants({ variant: 'primary', size: 'sm' })}
          >
            <MessageSquare className="size-4" aria-hidden /> {t('request.openChat')}
          </Link>
        )}
        {r.status === 'accepted' && r.bookingId && (
          <Link to="/sessions" className={buttonVariants({ size: 'sm' })}>
            <Video className="size-4" aria-hidden /> {t('request.viewSession')}
          </Link>
        )}
      </div>
      {dialog === 'other' && (
        <OtherTimeDialog r={r} open onOpenChange={(o) => setDialog(o ? 'other' : null)} />
      )}
      {dialog === 'decline' && (
        <DeclineDialog r={r} open onOpenChange={(o) => setDialog(o ? 'decline' : null)} />
      )}
    </Card>
  );
}

export function RequestsPage() {
  const { t } = useTranslation();
  const isMentor = useCan('mentorship:mentor');
  const [params, setParams] = useSearchParams();
  const box = isMentor && params.get('box') !== 'sent' ? 'received' : 'sent';
  const list = useQuery({
    ...SCREEN,
    queryKey: ['requests', box],
    queryFn: () => api.get<RequestView[]>(`/mentorship/requests?box=${box}`),
  });
  // A mentor saying yes is a signature moment (§3): the first time the mentee sees it, celebrate.
  useEffect(() => {
    if (box !== 'sent' || !list.data) return;
    const fresh = list.data.filter(justAccepted).map((r) => r.id);
    if (fresh.length && firstSighting('accepted-requests', fresh)) celebrate();
  }, [box, list.data]);
  // Opened from a notification: bring that request into view and focus it (audit IA-5).
  const focusId = params.get('request');
  useEffect(() => {
    if (!focusId || !list.data?.some((r) => r.id === focusId)) return;
    const el = document.getElementById(`request-${focusId}`);
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  }, [focusId, list.data]);
  return (
    <>
      <PageHeader title={t('nav.requests')} />
      {isMentor && (
        <Segmented
          label={t('nav.requests')}
          value={box}
          options={[
            ['received', t('request.received')],
            ['sent', t('request.sent')],
          ]}
          onChange={(v) => setParams({ box: v }, { replace: true })}
        />
      )}
      {list.isLoading && <Skeleton className="h-48" />}
      {list.isSuccess && !list.data.length && (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title={box === 'received' ? t('request.emptyReceived') : t('request.emptySent')}
          action={
            box === 'sent' ? (
              <Link to="/mentors" className={buttonVariants({ variant: 'primary' })}>
                {t('request.findMentor')}
              </Link>
            ) : undefined
          }
        />
      )}
      <ul className="grid gap-3">
        {list.data?.map((r) => (
          <li
            key={r.id}
            id={`request-${r.id}`}
            tabIndex={-1}
            className={cn(
              'rounded-[var(--radius-lg)] outline-none',
              r.id === focusId && 'ring-2 ring-brand ring-offset-2 ring-offset-bg',
            )}
          >
            <RequestCard r={r} box={box} />
          </li>
        ))}
      </ul>
    </>
  );
}
