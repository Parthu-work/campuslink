import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { Check, MailPlus, Plus, Search, Trash2, X } from 'lucide-react';
import { BRANCHES } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/field';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, Chip, EmptyState, Skeleton } from '../../components/ui/misc';
import { Dialog } from '../../components/ui/dialog';
import { FormError } from '../../components/layout/auth-layout';
import { api, apiRequest, ApiError } from '../../lib/api';
import { useFileUrl } from '../../lib/files';
import { useCan } from '../../lib/me';

interface ListRow {
  id: string;
  rollNumber: string;
  name: string;
  branch: string | null;
  gradYear: number | null;
  kind: 'student' | 'alumni';
  status: 'claimed' | 'unclaimed';
  email: string | null;
  hasPhone: boolean;
}

export function ListAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canInvite = useCan('users:invite');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'claimed' | 'unclaimed'>('');
  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState(false);
  const dq = useDeferredValue(q.trim());
  const params = new URLSearchParams({
    limit: '25',
    ...(dq ? { q: dq } : {}),
    ...(status ? { status } : {}),
  });
  const list = useInfiniteQuery({
    queryKey: ['whitelist', dq, status],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiRequest<ListRow[]>(`/admin/whitelist?${params}${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.meta?.nextCursor ?? undefined,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/whitelist/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['whitelist'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t('admin.listSearch')}</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-fg-3"
            aria-hidden
          />
          <Input
            type="search"
            enterKeyHint="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('admin.listSearch')}
            className="pl-11"
          />
        </label>
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden /> {t('admin.addPerson')}
        </Button>
        {canInvite && (
          <Button onClick={() => setInviting(true)}>
            <MailPlus className="size-4" aria-hidden /> {t('admin.inviteCta')}
          </Button>
        )}
      </div>
      <div role="group" aria-label={t('admin.status')} className="flex flex-wrap gap-2">
        {(
          [
            ['', t('admin.allStatuses')],
            ['unclaimed', t('admin.unclaimed')],
            ['claimed', t('admin.claimed')],
          ] as const
        ).map(([v, l]) => (
          <Chip key={v} pressed={status === v} onClick={() => setStatus(v)}>
            {l}
          </Chip>
        ))}
      </div>
      {list.isLoading && <Skeleton className="h-48" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.isSuccess && !rows.length && (
        <EmptyState art={<Illustration kind="people" />} title={t('admin.noUsers')} />
      )}
      {rows.length > 0 && (
        <Card className="overflow-x-auto" tabIndex={0} role="region" aria-label={t('admin.list')}>
          <table className="w-full min-w-[640px] text-left text-meta">
            <thead className="border-b border-line text-caption text-fg-3">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('admin.rollNumber')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('common.name')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('admin.kindField')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('common.email')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('admin.status')}
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">{t('admin.remove')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-mono text-caption">{r.rollNumber}</td>
                  <td className="px-4 py-2.5">
                    {r.name}
                    <span className="block text-caption text-fg-3">
                      {[r.branch, r.gradYear].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-caption">
                    {r.kind === 'alumni' ? t('admin.alumnus') : t('admin.student')}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-caption text-fg-2">
                    {r.email ?? (r.hasPhone ? t('profile.phone') : '—')}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={r.status === 'claimed' ? 'success' : 'neutral'}>
                      {r.status === 'claimed' ? t('admin.claimed') : t('admin.unclaimed')}
                    </Badge>
                  </td>
                  <td className="px-2 py-1 text-right">
                    {r.status === 'unclaimed' && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`${t('admin.remove')} ${r.rollNumber}`}
                        onClick={() => remove.mutate(r.id)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {list.hasNextPage && (
        <Button
          className="justify-self-center"
          onClick={() => void list.fetchNextPage()}
          loading={list.isFetchingNextPage}
        >
          {t('common.loadMore')}
        </Button>
      )}
      {adding && <AddPersonDialog onClose={() => setAdding(false)} />}
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
    </div>
  );
}

function AddPersonDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [v, setV] = useState({
    rollNumber: '',
    name: '',
    kind: 'student' as 'student' | 'alumni',
    branch: '',
    gradYear: '',
    email: '',
    phone: '',
    sendInvite: true,
  });
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: () =>
      api.post('/admin/whitelist', {
        rollNumber: v.rollNumber,
        name: v.name,
        kind: v.kind,
        sendInvite: v.sendInvite && !!v.email,
        ...(v.branch ? { branch: v.branch } : {}),
        ...(v.gradYear ? { gradYear: Number(v.gradYear) } : {}),
        ...(v.email ? { email: v.email } : {}),
        ...(v.phone ? { phone: v.phone } : {}),
      }),
    onSuccess: () => {
      toast.success(t('admin.added'));
      void qc.invalidateQueries({ queryKey: ['whitelist'] });
      onClose();
    },
    onError: (e: Error) =>
      setError(
        e instanceof ApiError && Array.isArray(e.details)
          ? (e.details as { message: string }[]).map((d) => d.message).join('. ')
          : e.message,
      ),
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV({ ...v, [k]: e.target.value });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.addPerson')}>
      <form className="grid gap-3" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <FormError message={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('admin.rollNumber')}>
            {({ id }) => (
              <Input
                id={id}
                value={v.rollNumber}
                onChange={set('rollNumber')}
                className="font-mono uppercase"
                required
              />
            )}
          </Field>
          <Field label={t('common.name')}>
            {({ id }) => <Input id={id} value={v.name} onChange={set('name')} required />}
          </Field>
          <Field label={t('admin.kindField')}>
            {({ id }) => (
              <Select id={id} value={v.kind} onChange={set('kind')}>
                <option value="student">{t('admin.student')}</option>
                <option value="alumni">{t('admin.alumnus')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('people.branch')}>
            {({ id }) => (
              <Select id={id} value={v.branch} onChange={set('branch')}>
                <option value="">—</option>
                {BRANCHES.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('verify.gradYear')}>
            {({ id }) => (
              <Input
                id={id}
                value={v.gradYear}
                onChange={set('gradYear')}
                inputMode="numeric"
                className="font-mono"
              />
            )}
          </Field>
          <Field label={t('common.email')}>
            {({ id }) => <Input id={id} type="email" value={v.email} onChange={set('email')} />}
          </Field>
          <Field label={t('profile.phone')}>
            {({ id }) => <Input id={id} value={v.phone} onChange={set('phone')} inputMode="tel" />}
          </Field>
        </div>
        <Checkbox id="send-invite" checked={v.sendInvite} onChange={(c) => setV({ ...v, sendInvite: c })}>
          {t('admin.sendInvite')}
        </Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {t('admin.addPerson')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const send = useMutation({
    mutationFn: () =>
      api.post<{ sent: number; existing: number }>('/admin/invites', {
        emails: text
          .split(/[\s,;]+/)
          .map((e) => e.trim())
          .filter(Boolean),
      }),
    onSuccess: (r) => {
      toast.success(t('admin.invitesSent', r));
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('admin.inviteTitle')}
      description={t('admin.inviteBody')}
    >
      <FormError message={error} />
      <Field label={t('common.email')}>
        {({ id }) => (
          <Textarea
            id={id}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="font-mono text-meta"
          />
        )}
      </Field>
      <p className="text-caption text-fg-3">{t('admin.phoneInvites')}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          loading={send.isPending}
          disabled={!text.trim()}
          onClick={() => send.mutate()}
        >
          {t('admin.invite')}
        </Button>
      </div>
    </Dialog>
  );
}

interface Request {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  rollNumber: string;
  gradYear: number | null;
  note: string;
  fileId: string;
  createdAt: string;
  reason: string | null;
  user: { id: string; name: string; email: string; roles: string[] } | null;
  listMatch: { name: string; gradYear: number | null; kind: string; status: string } | null;
}

export function VerificationAdmin() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const q = useQuery({
    queryKey: ['verification-queue', status],
    queryFn: () => api.get<Request[]>(`/admin/verification?status=${status}`),
  });
  return (
    <div className="grid gap-4">
      <div role="group" aria-label={t('admin.status')} className="flex flex-wrap gap-2">
        {(['pending', 'approved', 'rejected'] as const).map((s) => (
          <Chip key={s} pressed={status === s} onClick={() => setStatus(s)}>
            {t(`admin.${s}`)}
          </Chip>
        ))}
      </div>
      {q.isLoading && <Skeleton className="h-48" />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.isSuccess && !q.data.length && (
        <EmptyState art={<Illustration kind="done" />} title={t('admin.queueEmpty')} />
      )}
      <ul className="grid gap-3">
        {q.data?.map((r) => (
          <li key={r.id}>
            <RequestCard r={r} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequestCard({ r }: { r: Request }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const img = useFileUrl(r.fileId);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      api.post(`/admin/verification/${r.id}/decision`, {
        decision,
        ...(decision === 'reject' ? { reason } : {}),
      }),
    onSuccess: () => {
      toast.success(t('admin.decided'));
      setRejecting(false);
      void qc.invalidateQueries({ queryKey: ['verification-queue'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card className="grid gap-4 p-4 sm:grid-cols-[200px_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-[var(--radius-sm)] bg-surface-2">
        {img ? (
          <img
            src={img}
            alt={`${t('admin.idPhoto')}: ${r.user?.name ?? ''}`}
            className="aspect-[4/3] w-full object-contain"
          />
        ) : (
          <Skeleton className="aspect-[4/3] w-full" />
        )}
      </div>
      <div className="grid content-start gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <b>{r.user?.name}</b>
          <span className="text-meta text-fg-2">{r.user?.email}</span>
        </div>
        <p className="font-mono text-meta">
          {r.rollNumber}
          {r.gradYear ? ` · ${r.gradYear}` : ''}
        </p>
        <p className={r.listMatch ? 'text-meta text-success' : 'text-meta text-warning'}>
          {r.listMatch
            ? t('admin.listMatch', { name: r.listMatch.name, year: r.listMatch.gradYear ?? '—' })
            : t('admin.noListMatch')}
        </p>
        {r.note && <p className="rounded-[var(--radius-sm)] bg-surface-2 p-2 text-meta">“{r.note}”</p>}
        <p className="font-mono text-caption text-fg-3">
          {new Date(r.createdAt).toLocaleString(i18n.language)}
        </p>
        {r.reason && <p className="text-meta text-fg-2">{r.reason}</p>}
        {r.status === 'pending' && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              variant="primary"
              loading={decide.isPending && !rejecting}
              onClick={() => decide.mutate('approve')}
            >
              <Check className="size-4" aria-hidden /> {t('admin.approve')}
            </Button>
            <Button size="sm" onClick={() => setRejecting(true)}>
              <X className="size-4" aria-hidden /> {t('admin.reject')}
            </Button>
          </div>
        )}
      </div>
      {rejecting && (
        <Dialog open onOpenChange={(o) => !o && setRejecting(false)} title={t('admin.reject')}>
          <Field label={t('admin.rejectReason')}>
            {({ id }) => (
              <Textarea
                id={id}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
                autoFocus
              />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3}
              loading={decide.isPending}
              onClick={() => decide.mutate('reject')}
            >
              {t('admin.reject')}
            </Button>
          </div>
        </Dialog>
      )}
    </Card>
  );
}
