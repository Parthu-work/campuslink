import { useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import type { OutcomeImportResult, OutcomeKind, OutcomeView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Textarea } from '../../components/ui/field';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { Table, THead, Td, Th } from '../../components/ui/table';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { api, ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { OUTCOME_TONE, outcomeDetail, outcomeTitle } from '../../lib/outcomes';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';

type Status = 'reported' | 'verified' | 'rejected';
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function Decision({ outcome: o, onClose }: { outcome: OutcomeView; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'verify' | 'reject') =>
      api.post(
        `/admin/outcomes/${o.kind}/${o.id}/decision`,
        decision === 'reject' ? { decision, reason: reason.trim() } : { decision },
      ),
    onSuccess: (_r, decision) => {
      void qc.invalidateQueries({ queryKey: ['outcomes-queue'] });
      void qc.invalidateQueries({ queryKey: ['admin-overview'] });
      toast.success(decision === 'verify' ? t('outcomes.admin.verified') : t('outcomes.admin.rejected'));
      onClose();
    },
    onError: (e) => toast.error(errorText(e, t('errors.generic'))),
  });
  return (
    <Dialog
      open
      onOpenChange={(x) => !x && onClose()}
      title={outcomeTitle(t, o)}
      description={t('outcomes.admin.reviewBody')}
    >
      <div className="grid gap-4">
        <dl className="grid grid-cols-2 gap-3 text-meta">
          <div>
            <dt className="text-fg-3">{t('common.name')}</dt>
            <dd className="font-semibold">{o.member?.name || t('placements.admin.formerMember')}</dd>
          </div>
          <div>
            <dt className="text-fg-3">{t('admin.rollNumber')}</dt>
            <dd className="font-mono font-semibold">{o.member?.rollNumber ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-fg-3">{t('placements.admin.class')}</dt>
            <dd className="font-semibold">
              {[o.member?.branch, o.member?.gradYear].filter(Boolean).join(' · ') || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-fg-3">{t('outcomes.admin.details')}</dt>
            <dd className="font-semibold">{outcomeDetail(t, o)}</dd>
          </div>
        </dl>
        <Field label={t('placements.admin.rejectReason')} hint={t('outcomes.admin.rejectHint')}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            loading={decide.isPending && decide.variables === 'verify'}
            onClick={() => decide.mutate('verify')}
          >
            {t('placements.admin.verify')}
          </Button>
          <Button
            variant="ghost"
            disabled={reason.trim().length < 3}
            loading={decide.isPending && decide.variables === 'reject'}
            onClick={() => decide.mutate('reject')}
          >
            {t('placements.admin.reject')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** One kind of outcome for the placement cell: by status, with review and the college's sheet. */
export function OutcomesQueue({ kind }: { kind: OutcomeKind }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('reported');
  const [open, setOpen] = useState<OutcomeView | null>(null);
  const [imported, setImported] = useState<OutcomeImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const list = useInfiniteQuery({ ...SCREEN, ...q.outcomesQueue(kind, status) });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const importSheet = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.append('file', f);
      return api.upload<OutcomeImportResult>(`/admin/outcomes/${kind}/import`, form);
    },
    onSuccess: (r) => {
      setImported(r);
      void qc.invalidateQueries({ queryKey: ['outcomes-queue', kind] });
    },
    onError: (e) => toast.error(errorText(e, t('errors.generic'))),
  });
  const idBase = `outcomes-${kind}`;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[60ch] text-meta text-fg-2">{t(`outcomes.admin.intro.${kind}`)}</p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) importSheet.mutate(f);
          }}
        />
        <Button size="sm" loading={importSheet.isPending} onClick={() => fileRef.current?.click()}>
          <Upload className="size-4" aria-hidden /> {t('outcomes.admin.import')}
        </Button>
      </div>
      <p className="text-caption text-fg-3">{t(`outcomes.admin.columns.${kind}`)}</p>
      {imported && (
        <Card className="grid gap-1 p-3 text-meta" role="status">
          <p>{t('outcomes.admin.imported', { created: imported.created, updated: imported.updated })}</p>
          {imported.unknown.length > 0 && (
            <p className="text-warning-ink">
              {t('outcomes.admin.unknown', { list: imported.unknown.slice(0, 20).join(', ') })}
            </p>
          )}
          {imported.errors.slice(0, 5).map((e) => (
            <p key={e.row} className="text-danger-ink">
              {t('placements.admin.importRowError', { row: e.row, message: e.message })}
            </p>
          ))}
        </Card>
      )}
      <Tabs<Status>
        label={t('outcomes.admin.byStatus')}
        idBase={idBase}
        value={status}
        onChange={setStatus}
        tabs={(['reported', 'verified', 'rejected'] as const).map((s) => ({
          id: s,
          label: t(`outcomes.status.${s}`),
        }))}
      />
      <TabPanel idBase={idBase} id={status}>
        {list.isLoading && <Skeleton className="h-40" />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.isSuccess && !rows.length && (
          <EmptyState art={<Illustration kind="done" />} title={t(`outcomes.admin.none.${status}`)} />
        )}
        {rows.length > 0 && (
          <Table label={t(`outcomes.kind.${kind}`)}>
            <THead>
              <tr>
                <Th>{t('common.name')}</Th>
                <Th>{t('outcomes.admin.outcome')}</Th>
                <Th>{t('outcomes.admin.source')}</Th>
                <Th>{t('placements.admin.reported')}</Th>
                <Th>
                  {status === 'reported' ? t('placements.admin.decision') : t('placements.admin.status')}
                </Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <Td>
                    {o.member?.name || t('placements.admin.formerMember')}
                    <span className="block text-caption text-fg-2">
                      {[o.member?.rollNumber, o.member?.branch, o.member?.gradYear]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </Td>
                  <Td>
                    {outcomeTitle(t, o)}
                    <span className="block text-caption text-fg-2">{outcomeDetail(t, o)}</span>
                  </Td>
                  <Td>{t(`outcomes.source.${o.source}`)}</Td>
                  <Td>{formatDay(o.createdAt)}</Td>
                  <Td>
                    {status === 'reported' ? (
                      <Button size="sm" onClick={() => setOpen(o)}>
                        {t('placements.admin.review')}
                      </Button>
                    ) : (
                      <Badge tone={OUTCOME_TONE[o.status]}>{t(`outcomes.status.${o.status}`)}</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.hasNextPage && (
          <div className="mt-3">
            <Button onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
              {t('common.loadMore')}
            </Button>
          </div>
        )}
      </TabPanel>
      {open && <Decision outcome={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
