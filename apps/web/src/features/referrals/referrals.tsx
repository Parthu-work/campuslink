import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { Download, HandHelping, Inbox, Send } from 'lucide-react';
import { REFERRAL_DECLINE_TEMPLATES, type ReferralPrefsView, type ReferralView } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { Segmented } from '../../components/ui/tab-nav';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { api, apiBlob, ApiError, saveBlob } from '../../lib/api';
import { celebrate } from '../../lib/celebrate';
import { formatRelative } from '../../lib/format';
import { useCan } from '../../lib/me';
import { SCREEN } from '../../lib/query-client';

const TONE = {
  pending: 'warning',
  referred: 'success',
  declined: 'neutral',
  expired: 'neutral',
  withdrawn: 'neutral',
} as const;

function Settings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['referral-settings'],
    queryFn: () => api.get<ReferralPrefsView>('/me/referral-settings'),
  });
  const [draft, setDraft] = useState<{ accepting: boolean; weeklyCap: number; note: string } | null>(null);
  const v =
    draft ??
    (q.data ? { accepting: q.data.accepting, weeklyCap: q.data.weeklyCap, note: q.data.note } : null);
  const save = useMutation({
    mutationFn: () => api.put<ReferralPrefsView>('/me/referral-settings', v),
    onSuccess: (d) => {
      qc.setQueryData(['referral-settings'], d);
      setDraft(null);
      toast.success(t('common.saved'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  if (!q.data || !v) return <Skeleton className="h-40" />;
  return (
    <Card className="grid gap-3 p-4">
      <h2 className="font-semibold">{t('referrals.settings')}</h2>
      <p className="text-meta text-fg-2">
        {q.data.company ? t('referrals.settingsBody', { company: q.data.company }) : t('referrals.noCompany')}{' '}
        {!q.data.company && (
          <Link to="/profile" className="font-semibold text-brand-ink hover:underline">
            {t('nav.profile')}
          </Link>
        )}
      </p>
      <Checkbox
        id="ref-accepting"
        checked={v.accepting}
        onChange={(accepting) => setDraft({ ...v, accepting })}
      >
        {t('referrals.accepting')}
      </Checkbox>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field label={t('referrals.weeklyCap')} hint={t('referrals.used', { count: q.data.usedThisWeek })}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              min={1}
              max={20}
              value={v.weeklyCap}
              onChange={(e) =>
                setDraft({ ...v, weeklyCap: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })
              }
            />
          )}
        </Field>
        <Field label={t('referrals.noteLabel')} hint={t('referrals.noteHint')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              maxLength={300}
              value={v.note}
              onChange={(e) => setDraft({ ...v, note: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Button
        size="sm"
        variant="primary"
        className="justify-self-end"
        disabled={!draft}
        loading={save.isPending}
        onClick={() => save.mutate()}
      >
        {t('common.save')}
      </Button>
    </Card>
  );
}

function RespondDialog({ r, onClose }: { r: ReferralView; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'refer' | 'decline'>('refer');
  const [template, setTemplate] = useState<(typeof REFERRAL_DECLINE_TEMPLATES)[number]>('not_a_fit');
  const [note, setNote] = useState('');
  const respond = useMutation({
    mutationFn: () =>
      api.post(
        `/referrals/${r.id}/respond`,
        mode === 'refer'
          ? { action: 'refer', ...(note.trim() ? { note: note.trim() } : {}) }
          : { action: 'decline', template, ...(note.trim() ? { note: note.trim() } : {}) },
      ),
    onSuccess: () => {
      // Giving a referral is a moment worth marking (§6); a decline stays quiet.
      if (mode === 'refer') celebrate();
      toast.success(mode === 'refer' ? t('referrals.referredToast') : t('referrals.declinedToast'));
      void qc.invalidateQueries({ queryKey: ['referrals'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('referrals.respondTitle', { name: r.requester.name })}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          respond.mutate();
        }}
      >
        <Segmented
          label={t('referrals.decision')}
          value={mode}
          onChange={setMode}
          options={[
            ['refer', t('referrals.refer')],
            ['decline', t('referrals.decline')],
          ]}
        />
        {mode === 'decline' && (
          <Field label={t('referrals.reply')}>
            {({ id }) => (
              <Select
                id={id}
                value={template}
                onChange={(e) => setTemplate(e.target.value as typeof template)}
              >
                {REFERRAL_DECLINE_TEMPLATES.map((x) => (
                  <option key={x} value={x}>
                    {t(`referrals.templates.${x}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field
          label={t('referrals.noteToStudent')}
          hint={mode === 'refer' ? t('referrals.referHint') : undefined}
        >
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            type="submit"
            variant={mode === 'refer' ? 'primary' : 'secondary'}
            loading={respond.isPending}
          >
            {mode === 'refer' ? t('referrals.confirmRefer') : t('referrals.sendDecline')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ReferralRow({ r, box }: { r: ReferralView; box: 'received' | 'sent' }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [responding, setResponding] = useState(false);
  const person = box === 'received' ? r.requester : r.referrer;
  const withdraw = useMutation({
    mutationFn: () => api.post(`/referrals/${r.id}/withdraw`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['referrals'] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const download = useMutation({
    mutationFn: async () =>
      saveBlob(await apiBlob(`/files/${r.resumeFileId}`), `resume-${person.name.replace(/\s+/g, '-')}.pdf`),
    onError: () => toast.error(t('errors.generic')),
  });
  return (
    <li>
      <Card className="grid gap-2 p-4">
        <div className="flex items-start gap-3">
          <PersonAvatar name={person.name} fileId={person.avatarFileId} size={40} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {box === 'received' ? person.name : t('referrals.to', { name: person.name })}
            </p>
            <p className="text-meta text-fg-2">
              <Link to={`/jobs/${r.job.id}`} className="hover:underline">
                {r.job.title} · {r.job.company}
              </Link>
            </p>
            <p className="text-caption text-fg-3">{formatRelative(r.createdAt)}</p>
          </div>
          <Badge tone={TONE[r.status]}>{t(`referrals.status.${r.status}`)}</Badge>
        </div>
        <p className="text-meta whitespace-pre-wrap">{r.why}</p>
        {r.responseNote && (
          <p className="text-meta text-fg-2">
            <b>{t('referrals.theirNote')}</b> {r.responseNote}
          </p>
        )}
        {r.declineTemplate && (
          <p className="text-meta text-fg-2">{t(`referrals.templates.${r.declineTemplate}`)}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {r.resumeFileId && (
            <Button size="sm" loading={download.isPending} onClick={() => download.mutate()}>
              <Download className="size-4" aria-hidden /> {t('referrals.resume')}
            </Button>
          )}
          {box === 'received' && r.status === 'pending' && (
            <Button size="sm" variant="primary" onClick={() => setResponding(true)}>
              {t('referrals.respond')}
            </Button>
          )}
          {box === 'sent' && r.status === 'pending' && (
            <Button size="sm" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
              {t('referrals.withdraw')}
            </Button>
          )}
          {r.status === 'pending' && (
            <span className="ml-auto self-center text-caption text-fg-3">
              {t('referrals.expires', { when: formatRelative(r.expiresAt) })}
            </span>
          )}
        </div>
      </Card>
      {responding && <RespondDialog r={r} onClose={() => setResponding(false)} />}
    </li>
  );
}

export function ReferralsPage() {
  const { t } = useTranslation();
  const canOffer = useCan('referrals:offer');
  const canRequest = useCan('referrals:request');
  const [params, setParams] = useSearchParams();
  const box = (params.get('box') ?? (canOffer ? 'received' : 'sent')) === 'sent' ? 'sent' : 'received';
  const q = useQuery({
    ...SCREEN,
    queryKey: ['referrals', box],
    queryFn: () => api.get<ReferralView[]>(`/referrals?box=${box}`),
  });
  return (
    <div className="mx-auto grid w-full max-w-[860px] gap-5">
      <PageHeader
        icon={<HandHelping />}
        title={t('referrals.title')}
        intro={canOffer ? t('referrals.introAlumni') : t('referrals.introStudent')}
      />
      {canOffer && canRequest && (
        <Segmented
          label={t('referrals.box')}
          value={box}
          onChange={(v) => setParams({ box: v }, { replace: true })}
          options={[
            ['received', t('referrals.received')],
            ['sent', t('referrals.sentBox')],
          ]}
        />
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid content-start gap-3">
          {q.isLoading && <Skeleton className="h-32" />}
          {q.isSuccess && !q.data.length && (
            <EmptyState
              icon={box === 'received' ? <Inbox className="size-6" /> : <Send className="size-6" />}
              title={box === 'received' ? t('referrals.emptyReceived') : t('referrals.emptySent')}
            >
              {box === 'received' ? t('referrals.emptyReceivedBody') : t('referrals.emptySentBody')}
            </EmptyState>
          )}
          <ul className="grid gap-3">
            {q.data?.map((r) => (
              <ReferralRow key={r.id} r={r} box={box} />
            ))}
          </ul>
        </div>
        {canOffer && <Settings />}
      </div>
    </div>
  );
}
