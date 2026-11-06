import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Send, SlidersHorizontal } from 'lucide-react';
import {
  BRANCHES,
  READINESS_BANDS,
  READINESS_COMPONENTS,
  READINESS_WEIGHT_MAX,
  type NeedsHelpRow,
  type ReadinessBoardView,
  type ReadinessConfigView,
  type ReadinessNudgeResult,
  type ReadinessWeights,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Checkbox, Field, Input, Select } from '../../components/ui/field';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { Table, Td, TdNum, Th, THead } from '../../components/ui/table';
import { api, ApiError, apiBlob, saveBlob } from '../../lib/api';
import { formatDateTime, formatDay, newIdempotencyKey } from '../../lib/format';
import { useCan } from '../../lib/me';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';

const fail = (t: (k: string) => string) => (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'));

function WeightsDialog({ config, onClose }: { config: ReadinessConfigView; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [weights, setWeights] = useState<ReadinessWeights>(config.weights);
  const [threshold, setThreshold] = useState(config.threshold);
  const [closingDays, setClosingDays] = useState(config.closingDays);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.put<ReadinessConfigView>('/admin/readiness/config', { weights, threshold, closingDays }),
    onSuccess: (c) => {
      qc.setQueryData(q.readinessConfig().queryKey, c);
      void qc.invalidateQueries({ queryKey: ['readiness-board'] });
      toast.success(t('readinessBoard.weights.saved'));
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const total = READINESS_COMPONENTS.reduce((n, id) => n + weights[id], 0);
  const num = (v: string, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('readinessBoard.weights.title')}
      description={t('readinessBoard.weights.body')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            type="submit"
            form="readiness-weights"
            loading={save.isPending}
            disabled={total === 0}
          >
            {t('common.save')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <form
        id="readiness-weights"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (total > 0) save.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {READINESS_COMPONENTS.map((id) => (
            <Field
              key={id}
              label={t(`readiness.component.${id}`)}
              hint={
                config.available.includes(id)
                  ? t('readinessBoard.weights.share', {
                      n: total ? Math.round((weights[id] * 100) / total) : 0,
                    })
                  : t('readinessBoard.weights.notAvailable')
              }
            >
              {({ id: inputId, describedBy }) => (
                <Input
                  id={inputId}
                  aria-describedby={describedBy}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={READINESS_WEIGHT_MAX}
                  value={weights[id]}
                  onChange={(e) =>
                    setWeights({ ...weights, [id]: num(e.target.value, READINESS_WEIGHT_MAX) })
                  }
                />
              )}
            </Field>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('readinessBoard.weights.threshold')}
            hint={t('readinessBoard.weights.thresholdHint')}
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                value={threshold}
                onChange={(e) => setThreshold(Math.max(1, num(e.target.value, 100)))}
              />
            )}
          </Field>
          <Field label={t('readinessBoard.weights.closing')} hint={t('readinessBoard.weights.closingHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="number"
                inputMode="numeric"
                min={1}
                max={30}
                value={closingDays}
                onChange={(e) => setClosingDays(Math.max(1, num(e.target.value, 30)))}
              />
            )}
          </Field>
        </div>
        {total === 0 && <p className="text-meta text-danger">{t('readinessBoard.weights.none')}</p>}
        {error && (
          <p role="alert" className="text-meta text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function NudgeDialog({ rows, onClose }: { rows: NeedsHelpRow[]; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [key] = useState(newIdempotencyKey);
  const send = useMutation({
    mutationFn: () =>
      api.postOnce<ReadinessNudgeResult>(
        '/admin/readiness/nudge',
        { userIds: rows.map((r) => r.userId) },
        key,
      ),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['readiness-board'] });
      toast.success(t('readinessBoard.nudge.done', { count: r.sent, skipped: r.coolingOff + r.notListed }));
      onClose();
    },
    onError: fail(t),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('readinessBoard.nudge.title', { count: rows.length })}
      description={t('readinessBoard.nudge.body')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button variant="primary" loading={send.isPending} onClick={() => send.mutate()}>
            <Send className="size-4" aria-hidden /> {t('readinessBoard.nudge.send')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <p className="text-meta text-fg-2">{t('readinessBoard.nudge.caps')}</p>
    </Dialog>
  );
}

function NeedsHelp({ board, canManage }: { board: ReadinessBoardView; canManage: boolean }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [nudging, setNudging] = useState(false);
  const nudgeable = board.needsHelp.filter((r) => r.nudgeable);
  const chosen = board.needsHelp.filter((r) => picked.has(r.userId) && r.nudgeable);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  return (
    <section aria-labelledby="readiness-help" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="readiness-help" className="text-title font-semibold">
          {t('readinessBoard.help.title')}
        </h2>
        {canManage && nudgeable.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() =>
                setPicked(
                  chosen.length === nudgeable.length ? new Set() : new Set(nudgeable.map((r) => r.userId)),
                )
              }
            >
              {chosen.length === nudgeable.length
                ? t('readinessBoard.help.none')
                : t('readinessBoard.help.all')}
            </Button>
            <Button variant="primary" disabled={!chosen.length} onClick={() => setNudging(true)}>
              <Send className="size-4" aria-hidden />{' '}
              {t('readinessBoard.help.nudge', { count: chosen.length })}
            </Button>
          </div>
        )}
      </div>
      <p className="text-meta text-fg-2">
        {t('readinessBoard.help.intro', { threshold: board.threshold, days: board.closingDays })}
      </p>
      {!board.needsHelp.length ? (
        <EmptyState art={<Illustration kind="done" />} title={t('readinessBoard.help.emptyTitle')}>
          {t('readinessBoard.help.emptyBody')}
        </EmptyState>
      ) : (
        <Table label={t('readinessBoard.help.title')}>
          <THead>
            <tr>
              {canManage && (
                <Th>
                  <span className="sr-only">{t('readinessBoard.help.pick')}</span>
                </Th>
              )}
              <Th>{t('readinessBoard.help.student')}</Th>
              <Th>{t('readinessBoard.help.score')}</Th>
              <Th>{t('readinessBoard.help.drive')}</Th>
              <Th>{t('readinessBoard.help.next')}</Th>
              <Th>{t('readinessBoard.help.nudged')}</Th>
            </tr>
          </THead>
          <tbody>
            {board.needsHelp.map((r) => (
              <tr key={r.userId} className="border-t border-line">
                {canManage && (
                  <Td>
                    {r.nudgeable ? (
                      <Checkbox
                        id={`pick-${r.userId}`}
                        checked={picked.has(r.userId)}
                        onChange={(on) => toggle(r.userId, on)}
                      >
                        <span className="sr-only">{t('readinessBoard.help.pickOne', { name: r.name })}</span>
                      </Checkbox>
                    ) : null}
                  </Td>
                )}
                <Td>
                  <span className="font-semibold">{r.name}</span>
                  <span className="block text-caption text-fg-3">
                    {[r.branch, r.gradYear].filter(Boolean).join(' · ')}
                  </span>
                </Td>
                <TdNum>{r.score}</TdNum>
                <Td>
                  {r.drive.company}
                  <span className="block text-caption text-fg-3">
                    {t('readinessBoard.help.closes', { time: formatDateTime(r.drive.closesAt) })}
                  </span>
                </Td>
                <Td>
                  {r.next
                    ? t(`readiness.action.${r.next.id}`, {
                        count: r.next.count ?? 1,
                        cgpa: r.next.target ?? '',
                        dimension: r.next.target ? t(`readiness.dimension.${r.next.target}`) : '',
                      })
                    : '–'}
                </Td>
                <Td>{r.lastNudgedAt ? formatDay(r.lastNudgedAt) : '–'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {nudging && (
        <NudgeDialog
          rows={chosen}
          onClose={() => {
            setNudging(false);
            setPicked(new Set());
          }}
        />
      )}
    </section>
  );
}

/**
 * The readiness board (prompt 2, G5): how ready each batch and branch is (small counts hidden),
 * who needs help before a drive closes, nudges, weights and export. Minors are never listed.
 */
export function ReadinessAdmin() {
  const { t } = useTranslation();
  const canManage = useCan('readiness:manage');
  const [branch, setBranch] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'' | 'csv' | 'xlsx'>('');
  const qs = new URLSearchParams({
    ...(branch ? { branch } : {}),
    ...(gradYear ? { gradYear } : {}),
  }).toString();
  const board = useQuery({ ...SCREEN, ...q.readinessBoard(qs), placeholderData: keepPreviousData });
  const all = useQuery(q.readinessBoard(''));
  const config = useQuery(q.readinessConfig());
  const years = [
    ...new Set((all.data?.groups ?? []).map((g) => g.gradYear).filter((y): y is number => !!y)),
  ].sort((a, b) => b - a);
  const exportAs = async (format: 'csv' | 'xlsx') => {
    setBusy(format);
    try {
      const blob = await apiBlob(
        `/admin/readiness/export?${new URLSearchParams({ format, ...(branch ? { branch } : {}), ...(gradYear ? { gradYear } : {}) }).toString()}`,
      );
      saveBlob(blob, `readiness.${format}`);
    } catch (e) {
      fail(t)(e);
    } finally {
      setBusy('');
    }
  };
  const b = board.data;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-[60ch] text-fg-2">{t('readinessBoard.intro')}</p>
        <div className="flex flex-wrap gap-2">
          {config.data && canManage && (
            <Button variant="ghost" onClick={() => setEditing(true)}>
              <SlidersHorizontal className="size-4" aria-hidden /> {t('readinessBoard.weights.open')}
            </Button>
          )}
          {canManage && (
            <>
              <Button variant="ghost" loading={busy === 'csv'} onClick={() => void exportAs('csv')}>
                <Download className="size-4" aria-hidden /> {t('readinessBoard.exportCsv')}
              </Button>
              <Button variant="ghost" loading={busy === 'xlsx'} onClick={() => void exportAs('xlsx')}>
                <Download className="size-4" aria-hidden /> {t('readinessBoard.exportXlsx')}
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 md:max-w-[480px]">
        <Field label={t('readinessBoard.branch')}>
          {({ id }) => (
            <Select id={id} size="sm" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">{t('readinessBoard.allBranches')}</option>
              {BRANCHES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('readinessBoard.batch')}>
          {({ id }) => (
            <Select id={id} size="sm" value={gradYear} onChange={(e) => setGradYear(e.target.value)}>
              <option value="">{t('readinessBoard.allBatches')}</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {board.isLoading && <Skeleton className="h-80 rounded-[var(--radius-lg)]" />}
      {board.isError && <ErrorState error={board.error} onRetry={() => void board.refetch()} />}
      {b && (
        <>
          <StatGrid>
            <StatCard label={t('readinessBoard.students')} value={b.students} />
            <StatCard label={t('readinessBoard.needsHelp')} value={b.needsHelp.length} />
            <StatCard label={t('readinessBoard.threshold')} value={b.threshold} />
            <StatCard
              label={t('readinessBoard.closing')}
              value={t('readinessBoard.days', { count: b.closingDays })}
            />
          </StatGrid>
          <NeedsHelp board={b} canManage={canManage} />
          <section aria-labelledby="readiness-dist" className="grid gap-3">
            <h2 id="readiness-dist" className="text-title font-semibold">
              {t('readinessBoard.dist.title')}
            </h2>
            <p className="text-meta text-fg-2">{t('readinessBoard.dist.intro')}</p>
            {!b.groups.length ? (
              <EmptyState art={<Illustration kind="people" />} title={t('readinessBoard.dist.empty')} />
            ) : (
              <Table label={t('readinessBoard.dist.title')}>
                <THead>
                  <tr>
                    <Th>{t('readinessBoard.batch')}</Th>
                    <Th>{t('readinessBoard.branch')}</Th>
                    <Th>{t('readinessBoard.students')}</Th>
                    {READINESS_BANDS.map((lo) => (
                      <Th key={lo}>{lo === 80 ? '80–100' : `${lo}–${lo + 19}`}</Th>
                    ))}
                    <Th>{t('readinessBoard.dist.median')}</Th>
                  </tr>
                </THead>
                <tbody>
                  {b.groups.map((g) => (
                    <tr key={`${g.gradYear}-${g.branch}`} className="border-t border-line">
                      <Td>{g.gradYear ?? '–'}</Td>
                      <Td>{g.branch ?? '–'}</Td>
                      <TdNum>{g.students}</TdNum>
                      {g.bands.map((n, i) => (
                        <TdNum key={READINESS_BANDS[i]}>{n}</TdNum>
                      ))}
                      <TdNum>{g.median ?? '–'}</TdNum>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>
          <section aria-labelledby="readiness-parts" className="grid gap-3">
            <h2 id="readiness-parts" className="text-title font-semibold">
              {t('readinessBoard.parts.title')}
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {b.components.map((c) => (
                <li key={c.id}>
                  <Card className="flex items-center justify-between gap-3 p-4">
                    <span className="font-semibold">{t(`readiness.component.${c.id}`)}</span>
                    {c.status === 'scored' ? (
                      <span className="text-meta tabular-nums text-fg-2">
                        {c.average === null
                          ? t('readinessBoard.parts.few')
                          : t('readinessBoard.parts.average', { n: c.average })}
                      </span>
                    ) : (
                      <Badge>{t(`readiness.status.${c.status}`)}</Badge>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </section>
          <p className="text-caption text-fg-3">{t('readinessBoard.privacy')}</p>
        </>
      )}
      {editing && config.data && <WeightsDialog config={config.data} onClose={() => setEditing(false)} />}
    </div>
  );
}
