import { useDeferredValue, useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { Check, MailPlus, Plus, Search, Trash2, X } from 'lucide-react';
import { BRANCHES, type BulkDecisionResult } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/field';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, Chip, EmptyState, Skeleton } from '../../components/ui/misc';
import { DataTable, type Column } from '../../components/ui/data-table';
import { TableSkeleton } from '../../components/ui/skeleton-shapes';
import { Dialog, Sheet } from '../../components/ui/dialog';
import { FormError } from '../../components/layout/auth-layout';
import { api, apiRequest, ApiError } from '../../lib/api';
import { useFileUrl } from '../../lib/files';
import { formatRelative } from '../../lib/format';
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
      {list.isLoading && <TableSkeleton columns={4} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.isSuccess && !rows.length && (
        <EmptyState art={<Illustration kind="people" />} title={t('admin.noUsers')} />
      )}
      {rows.length > 0 && (
        <Card
          className="relative overflow-x-auto [contain:inline-size]"
          tabIndex={0}
          role="region"
          aria-label={t('admin.list')}
        >
          <table className="w-full min-w-[640px] text-left text-callout">
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
            className="font-mono text-callout"
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
  /** `guardian_manual`: a minor's guardian number to check against admission records (no photo). */
  method: 'id_card' | 'guardian_manual';
  fileId: string | null;
  guardianPhone: string | null;
  createdAt: string;
  reason: string | null;
  user: { id: string; name: string; email: string | null; roles: string[] } | null;
  listMatch: { name: string; gradYear: number | null; kind: string; status: string } | null;
}

/**
 * Verification requests (B6; prompt 3, U9: the staff table pattern): one compact row per request,
 * sortable, selected rows decided together from a sticky bar, and a row opening the request in a
 * side panel with the ID photo and its own Approve and Reject.
 */
export function VerificationAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [selected, setSelected] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState<Request | null>(null);
  const q = useQuery({
    queryKey: ['verification-queue', status],
    queryFn: () => api.get<Request[]>(`/admin/verification?status=${status}`),
  });
  // B6: decide many at once; each is decided and audited on its own, and failures are listed.
  const bulk = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      api.post<BulkDecisionResult[]>('/admin/verification/bulk-decision', {
        ids: selected,
        decision,
        ...(decision === 'reject' ? { reason } : {}),
      }),
    onSuccess: (rows) => {
      const failed = rows.filter((r) => !r.ok).length;
      if (failed) toast.error(t('admin.bulkPartial', { ok: rows.length - failed, failed }));
      else toast.success(t('admin.bulkDone', { count: rows.length }));
      setSelected([]);
      setRejecting(false);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['verification-queue'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = q.data ?? [];
  const pending = status === 'pending';
  const name = (r: Request) => r.user?.name ?? r.rollNumber;
  const columns: Column<Request>[] = [
    {
      key: 'name',
      header: t('staff.table.student'),
      sort: (r) => name(r).toLowerCase(),
      cell: (r) => (
        <span className="grid gap-0.5">
          <span className="font-semibold text-fg">{name(r)}</span>
          {r.user?.email && <span className="text-caption break-all text-fg-2">{r.user.email}</span>}
        </span>
      ),
    },
    {
      key: 'roll',
      header: t('staff.table.roll'),
      sort: (r) => r.rollNumber,
      cell: (r) => (
        <span className="font-mono">
          {r.rollNumber}
          {r.gradYear ? ` · ${r.gradYear}` : ''}
        </span>
      ),
    },
    {
      key: 'list',
      header: t('staff.table.list'),
      sort: (r) => (r.listMatch ? 0 : 1),
      cell: (r) =>
        r.listMatch ? (
          <span className="inline-flex items-center gap-1 text-success-ink">
            <Check className="size-4" aria-hidden /> {t('staff.table.onList')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-warning-ink">
            <X className="size-4" aria-hidden /> {t('staff.table.notOnList')}
          </span>
        ),
    },
    {
      key: 'sent',
      header: t('staff.table.sent'),
      sort: (r) => Date.parse(r.createdAt),
      wide: true,
      cell: (r) => formatRelative(r.createdAt),
    },
  ];
  return (
    <div className="grid gap-4">
      <div role="group" aria-label={t('admin.status')} className="flex flex-wrap gap-2">
        {(['pending', 'approved', 'rejected'] as const).map((st) => (
          <Chip
            key={st}
            pressed={status === st}
            onClick={() => {
              setStatus(st);
              setSelected([]);
            }}
          >
            {t(`admin.${st}`)}
          </Chip>
        ))}
      </div>
      {q.isLoading && <TableSkeleton columns={4} />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.isSuccess && !rows.length && (
        <EmptyState art={<Illustration kind="done" />} title={t('admin.queueEmpty')} />
      )}
      {rows.length > 0 && (
        <DataTable
          label={t('admin.ov.verification')}
          rows={rows}
          rowKey={(r) => r.id}
          columns={columns}
          initialSort={{ key: 'sent', dir: 'asc' }}
          onOpen={setOpen}
          {...(pending
            ? {
                selection: {
                  selected,
                  onChange: (ids: string[]) => setSelected(ids.slice(0, 100)),
                  rowLabel: (r: Request) => t('admin.selectRequest', { name: name(r) }),
                  allLabel: t('admin.selectAll'),
                },
              }
            : {})}
          bar={
            <>
              <span className="text-callout font-semibold" role="status">
                {t('admin.selectedCount', { count: selected.length })}
              </span>
              <div className="ms-auto flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                  {t('staff.table.clear')}
                </Button>
                <Button size="sm" onClick={() => setRejecting(true)}>
                  {t('admin.rejectSelected')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={bulk.isPending && !rejecting}
                  onClick={() => bulk.mutate('approve')}
                >
                  {t('admin.approveSelected')}
                </Button>
              </div>
            </>
          }
        />
      )}
      <Sheet
        open={!!open}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open ? name(open) : ''}
        history={false}
      >
        {open && <RequestCard r={open} onDecided={() => setOpen(null)} />}
      </Sheet>
      <Dialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={t('admin.rejectSelectedTitle', { count: selected.length })}
        description={t('admin.rejectSelectedBody')}
        footer={
          <Button
            variant="danger"
            disabled={reason.trim().length < 3}
            loading={bulk.isPending}
            onClick={() => bulk.mutate('reject')}
          >
            {t('admin.rejectSelected')}
          </Button>
        }
      >
        <Field label={t('admin.rejectReason')}>
          {({ id }) => (
            <Textarea id={id} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
        </Field>
      </Dialog>
    </div>
  );
}

function RequestCard({
  r,
  selected,
  onSelect,
  onDecided,
}: {
  r: Request;
  /** B6 bulk decisions: present only in the pending list. */
  selected?: boolean;
  onSelect?: (on: boolean) => void;
  /** The side panel closes once the request is decided (prompt 3, U9). */
  onDecided?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const img = useFileUrl(r.fileId ?? undefined);
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
      onDecided?.();
      void qc.invalidateQueries({ queryKey: ['verification-queue'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card className="grid gap-4 p-4 sm:grid-cols-[200px_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-[var(--radius-sm)] bg-surface-2">
        {r.method === 'guardian_manual' ? (
          <div className="grid aspect-[4/3] w-full content-center gap-1 p-4 text-center">
            <p className="eyebrow">{t('guardian.adminLabel')}</p>
            <p className="font-mono text-headline font-semibold">{r.guardianPhone}</p>
            <p className="text-caption text-fg-2">{t('guardian.adminHint')}</p>
          </div>
        ) : img ? (
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
        {onSelect && (
          <Checkbox id={`select-${r.id}`} checked={!!selected} onChange={onSelect}>
            {t('admin.selectRequest', { name: r.user?.name ?? '' })}
          </Checkbox>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <b>{r.user?.name}</b>
          <span className="text-callout text-fg-2">{r.user?.email}</span>
        </div>
        <p className="font-mono text-callout">
          {r.rollNumber}
          {r.gradYear ? ` · ${r.gradYear}` : ''}
        </p>
        <p className={r.listMatch ? 'text-callout text-success' : 'text-callout text-warning'}>
          {r.listMatch
            ? t('admin.listMatch', { name: r.listMatch.name, year: r.listMatch.gradYear ?? '—' })
            : t('admin.noListMatch')}
        </p>
        {r.note && <p className="rounded-[var(--radius-sm)] bg-surface-2 p-2 text-callout">“{r.note}”</p>}
        <p className="font-mono text-caption text-fg-3">
          {new Date(r.createdAt).toLocaleString(i18n.language)}
        </p>
        {r.reason && <p className="text-callout text-fg-2">{r.reason}</p>}
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
