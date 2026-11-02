import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Pencil, Upload, UserPlus } from 'lucide-react';
import {
  DRIVE_ROLE_TYPES,
  EXPORT_COLUMNS,
  FINAL_RESULTS,
  ROUND_RESULTS,
  type DriveRoleType,
  type DriveStatus,
  type DriveView,
  type ExportColumn,
  type FinalResult,
  type RegistrantView,
  type RoundImportResult,
  type RoundResult,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/field';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { Segmented } from '../../components/ui/tab-nav';
import { Table, THead, Td, Th } from '../../components/ui/table';
import { api, ApiError, apiBlob, saveBlob } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/me';
import { DRIVE_KEYS } from '../../lib/placements';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';

/** Mirrors the API's allowed status changes (it decides; this only offers the buttons). */
const NEXT: Record<DriveStatus, readonly DriveStatus[]> = {
  draft: ['open', 'cancelled'],
  open: ['closed', 'in_progress', 'cancelled'],
  closed: ['open', 'in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};
const DEFAULT_COLUMNS: readonly ExportColumn[] = [
  'rollNumber',
  'name',
  'branch',
  'gradYear',
  'email',
  'cgpa',
];

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function StatusActions({ drive: d }: { drive: DriveView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<DriveStatus | null>(null);
  const change = useMutation({
    mutationFn: (status: DriveStatus) =>
      api.post<DriveView>(`/admin/placements/drives/${d.id}/status`, { status }),
    onSuccess: (v) => {
      setConfirm(null);
      qc.setQueryData(['placement-drive', d.id], v);
      for (const queryKey of DRIVE_KEYS) void qc.invalidateQueries({ queryKey });
      toast.success(t(`placements.admin.statusDone.${v.status}`));
    },
    onError: (e) => toast.error(errorText(e, t('errors.generic'))),
  });
  const next = NEXT[d.status];
  return (
    <div className="flex flex-wrap gap-2">
      {next.map((s) => (
        <Button
          key={s}
          variant={
            s === 'open' && d.status === 'draft' ? 'primary' : s === 'cancelled' ? 'ghost' : 'secondary'
          }
          loading={change.isPending && change.variables === s}
          onClick={() => (s === 'open' || s === 'cancelled' ? setConfirm(s) : change.mutate(s))}
        >
          {t(`placements.admin.to.${d.status === 'closed' && s === 'open' ? 'reopen' : s}`)}
        </Button>
      ))}
      {['draft', 'open', 'closed'].includes(d.status) && (
        <Link to={`/admin/placements/${d.id}/edit`} className={buttonVariants({ variant: 'ghost' })}>
          <Pencil className="size-4" aria-hidden /> {t('placements.admin.edit')}
        </Link>
      )}
      <Dialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'cancelled' ? t('placements.admin.cancelTitle') : t('placements.admin.openTitle')}
        description={
          confirm === 'cancelled' ? t('placements.admin.cancelBody') : t('placements.admin.openBody')
        }
      >
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant={confirm === 'cancelled' ? 'danger' : 'primary'}
            loading={change.isPending}
            onClick={() => confirm && change.mutate(confirm)}
          >
            {confirm === 'cancelled' ? t('placements.admin.to.cancelled') : t('placements.admin.to.open')}
          </Button>
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            {t('common.back')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/** Let one ineligible student register, by the roll number the cell knows (audited, with a reason). */
function OverrideDialog({ drive: d, onClose }: { drive: DriveView; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [roll, setRoll] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const send = useMutation({
    mutationFn: () =>
      api.post(`/admin/placements/drives/${d.id}/override`, {
        rollNumber: roll.trim().toUpperCase(),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success(t('placements.admin.overrideDone', { roll: roll.trim().toUpperCase() }));
      void qc.invalidateQueries({ queryKey: ['placement-drive', d.id] });
      onClose();
    },
    onError: (e) => setError(errorText(e, t('errors.generic'))),
  });
  const ready = roll.trim().length >= 4 && reason.trim().length >= 5;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('placements.admin.overrideTitle')}
      description={t('placements.admin.overrideBody')}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) send.mutate();
        }}
      >
        <Field label={t('admin.rollNumber')}>
          {({ id }) => (
            <Input
              id={id}
              className="font-mono uppercase"
              maxLength={20}
              autoComplete="off"
              value={roll}
              onChange={(e) => setRoll(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('placements.admin.overrideReason')} hint={t('placements.admin.overrideReasonHint')}>
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
        {error && (
          <p role="alert" className="text-meta font-medium text-danger">
            {error}
          </p>
        )}
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button variant="primary" type="submit" loading={send.isPending} disabled={!ready}>
            {t('placements.admin.letIn')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Only the columns the company needs, as CSV or Excel (the export is audited). */
function ExportDialog({ drive: d, onClose }: { drive: DriveView; onClose: () => void }) {
  const { t } = useTranslation();
  const [columns, setColumns] = useState<ExportColumn[]>([...DEFAULT_COLUMNS]);
  const [format, setFormat] = useState<'csv' | 'xlsx'>('xlsx');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const ordered = EXPORT_COLUMNS.filter((c) => columns.includes(c));
      const blob = await apiBlob(
        `/admin/placements/drives/${d.id}/export?format=${format}&columns=${ordered.join(',')}`,
      );
      saveBlob(blob, `${d.company.name.replace(/[^\w]+/g, '-')}-registrants.${format}`);
      onClose();
    } catch (e) {
      toast.error(errorText(e, t('errors.generic')));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('placements.admin.exportTitle')}
      description={t('placements.admin.exportBody')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button variant="primary" loading={busy} disabled={!columns.length} onClick={() => void run()}>
            <Download className="size-4" aria-hidden /> {t('placements.admin.download')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <Segmented<'csv' | 'xlsx'>
          label={t('placements.admin.format')}
          value={format}
          onChange={setFormat}
          options={[
            ['xlsx', t('placements.admin.excel')],
            ['csv', 'CSV'],
          ]}
        />
        <fieldset className="grid gap-1 sm:grid-cols-2">
          <legend className="mb-1.5 text-meta font-semibold">{t('placements.admin.columns')}</legend>
          {EXPORT_COLUMNS.map((c) => (
            <Checkbox
              key={c}
              id={`export-${c}`}
              checked={columns.includes(c)}
              onChange={(v) => setColumns((x) => (v ? [...x, c] : x.filter((y) => y !== c)))}
            >
              {t(`placements.admin.col.${c}`)}
            </Checkbox>
          ))}
        </fieldset>
        <p className="text-caption text-fg-3">{t('placements.admin.exportAudit')}</p>
      </div>
    </Dialog>
  );
}

/** A selection records a verified offer: confirm the role and exact CTC first. */
function SelectDialog({
  drive: d,
  registrant: r,
  onClose,
}: {
  drive: DriveView;
  registrant: RegistrantView;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const first = d.roles[0];
  const [role, setRole] = useState(first?.title ?? d.title);
  const [ctc, setCtc] = useState(String(first?.ctcMaxLpa ?? first?.ctcMinLpa ?? ''));
  const [type, setType] = useState<DriveRoleType>(first?.type ?? 'full_time');
  const save = useMutation({
    mutationFn: () =>
      api.put(`/admin/placements/registrations/${r.id}/final`, {
        final: 'selected',
        role: role.trim(),
        ctcLpa: Number(ctc),
        type,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['drive-registrants', d.id] });
      toast.success(t('placements.admin.selectedDone', { name: r.name }));
      onClose();
    },
    onError: (e) => toast.error(errorText(e, t('errors.generic'))),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('placements.admin.selectTitle', { name: r.name })}
      description={t('placements.admin.selectBody')}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label={t('placements.field.role')}>
          {({ id }) => (
            <Input id={id} maxLength={120} value={role} onChange={(e) => setRole(e.target.value)} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('placements.field.ctc')}>
            {({ id }) => (
              <Input
                id={id}
                inputMode="decimal"
                value={ctc}
                onChange={(e) => setCtc(e.target.value.replace(/[^\d.]/g, ''))}
              />
            )}
          </Field>
          <Field label={t('placements.field.roleType')}>
            {({ id }) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as DriveRoleType)}>
                {DRIVE_ROLE_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`placements.roleType.${x}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            type="submit"
            loading={save.isPending}
            disabled={role.trim().length < 2 || !(Number(ctc) >= 0) || ctc === ''}
          >
            {t('placements.admin.recordSelection')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Registrants with the round picked above: results as selects, saved together; final results per row. */
function Registrants({ drive: d }: { drive: DriveView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery(q.driveRegistrants(d.id));
  const [round, setRound] = useState(0);
  const [edits, setEdits] = useState<Record<string, RoundResult>>({});
  const [selecting, setSelecting] = useState<RegistrantView | null>(null);
  const [imported, setImported] = useState<RoundImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const started = ['in_progress', 'completed', 'closed'].includes(d.status);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['drive-registrants', d.id] });
  const fail = (e: unknown) => toast.error(errorText(e, t('errors.generic')));
  const saveRound = useMutation({
    mutationFn: () =>
      api.put(`/admin/placements/drives/${d.id}/rounds/${round}`, {
        results: Object.entries(edits).map(([registrationId, result]) => ({ registrationId, result })),
      }),
    onSuccess: () => {
      setEdits({});
      refresh();
      toast.success(t('placements.admin.roundSaved'));
    },
    onError: fail,
  });
  const importRound = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.append('file', f);
      return api.upload<RoundImportResult>(`/admin/placements/drives/${d.id}/rounds/${round}/import`, form);
    },
    onSuccess: (r) => {
      setImported(r);
      setEdits({});
      refresh();
    },
    onError: fail,
  });
  const final = useMutation({
    mutationFn: ({ id, value }: { id: string; value: FinalResult }) =>
      api.put(`/admin/placements/registrations/${id}/final`, { final: value }),
    onSuccess: refresh,
    onError: fail,
  });
  const resume = async (r: RegistrantView) => {
    if (!r.resumeFileId) return;
    try {
      saveBlob(await apiBlob(`/files/${r.resumeFileId}`), `resume-${r.rollNumber ?? r.id}.pdf`);
    } catch (e) {
      fail(e);
    }
  };
  if (list.isLoading) return <Skeleton className="h-48" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  const rows = list.data ?? [];
  if (!rows.length)
    return (
      <EmptyState art={<Illustration kind="people" />} title={t('placements.admin.noRegistrants')}>
        {d.status === 'draft'
          ? t('placements.admin.noRegistrantsDraft')
          : t('placements.admin.noRegistrantsBody')}
      </EmptyState>
    );
  const resultOf = (r: RegistrantView) =>
    edits[r.id] ?? r.roundResults.find((x) => x.round === round)?.result ?? 'pending';
  const active = (r: RegistrantView) => r.status !== 'withdrawn';
  return (
    <div className="grid gap-3">
      {d.rounds.length > 0 && started && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('placements.admin.round')}>
            {({ id }) => (
              <Select
                id={id}
                size="sm"
                value={round}
                onChange={(e) => {
                  setRound(Number(e.target.value));
                  setEdits({});
                  setImported(null);
                }}
              >
                {d.rounds.map((r, i) => (
                  <option key={i} value={i}>
                    {i + 1}. {r.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button
            variant="primary"
            size="sm"
            disabled={!Object.keys(edits).length}
            loading={saveRound.isPending}
            onClick={() => saveRound.mutate()}
          >
            {t('placements.admin.saveRound', { count: Object.keys(edits).length })}
          </Button>
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
              if (f) importRound.mutate(f);
            }}
          />
          <Button size="sm" loading={importRound.isPending} onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" aria-hidden /> {t('placements.admin.importRound')}
          </Button>
        </div>
      )}
      {imported && (
        <Card className="grid gap-1 p-3 text-meta" role="status">
          <p>
            {t('placements.admin.imported', { updated: imported.updated, unchanged: imported.unchanged })}
          </p>
          {imported.unknown.length > 0 && (
            <p className="text-warning-ink">
              {t('placements.admin.importUnknown', { list: imported.unknown.slice(0, 20).join(', ') })}
            </p>
          )}
          {imported.errors.slice(0, 5).map((e) => (
            <p key={e.row} className="text-danger-ink">
              {t('placements.admin.importRowError', { row: e.row, message: e.message })}
            </p>
          ))}
        </Card>
      )}
      <Table label={t('placements.admin.registrants')}>
        <THead>
          <tr>
            <Th>{t('admin.rollNumber')}</Th>
            <Th>{t('common.name')}</Th>
            <Th>{t('placements.admin.class')}</Th>
            <Th>{t('placements.field.cgpa')}</Th>
            <Th>{t('placements.resume')}</Th>
            {d.rounds.length > 0 && started && <Th>{d.rounds[round]?.name}</Th>}
            <Th>{t('placements.admin.final')}</Th>
          </tr>
        </THead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={active(r) ? undefined : 'text-fg-3'}>
              <Td className="font-mono">{r.rollNumber ?? '—'}</Td>
              <Td>
                {r.name || t('placements.admin.formerMember')}{' '}
                {r.status === 'tpo_override' && <Badge tone="info">{t('placements.admin.letInBadge')}</Badge>}
                {r.status === 'withdrawn' && <Badge>{t('placements.admin.withdrawnBadge')}</Badge>}
              </Td>
              <Td>{[r.branch, r.gradYear].filter(Boolean).join(' · ')}</Td>
              <Td className="tabular-nums">{r.cgpa ?? '—'}</Td>
              <Td>
                {r.resumeFileId ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('placements.admin.resumeOf', { name: r.name })}
                    onClick={() => void resume(r)}
                  >
                    <FileText className="size-4" aria-hidden />
                  </Button>
                ) : (
                  '—'
                )}
              </Td>
              {d.rounds.length > 0 && started && (
                <Td>
                  {active(r) && (
                    <label>
                      <span className="sr-only">
                        {t('placements.admin.resultFor', {
                          name: r.name,
                          round: d.rounds[round]?.name ?? '',
                        })}
                      </span>
                      <Select
                        size="sm"
                        value={resultOf(r)}
                        onChange={(e) => setEdits((x) => ({ ...x, [r.id]: e.target.value as RoundResult }))}
                      >
                        {ROUND_RESULTS.map((x) => (
                          <option key={x} value={x}>
                            {t(`placements.result.${x}`)}
                          </option>
                        ))}
                      </Select>
                    </label>
                  )}
                </Td>
              )}
              <Td>
                {active(r) && started ? (
                  <label>
                    <span className="sr-only">{t('placements.admin.finalFor', { name: r.name })}</span>
                    <Select
                      size="sm"
                      value={r.final}
                      onChange={(e) => {
                        const value = e.target.value as FinalResult;
                        if (value === 'selected') setSelecting(r);
                        else final.mutate({ id: r.id, value });
                      }}
                    >
                      {FINAL_RESULTS.filter((x) => x !== 'withdrawn').map((x) => (
                        <option key={x} value={x}>
                          {t(`placements.final.${x}`)}
                        </option>
                      ))}
                    </Select>
                  </label>
                ) : (
                  t(`placements.final.${r.final}`)
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {selecting && <SelectDialog drive={d} registrant={selecting} onClose={() => setSelecting(null)} />}
    </div>
  );
}

/** Admin › Placements › a drive: status, registrants, round results, finals, overrides and export. */
export function DriveManage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const canExport = useCan('reports:export');
  const drive = useQuery({ ...SCREEN, ...q.placementDrive(id) });
  const [dialog, setDialog] = useState<'override' | 'export' | null>(null);
  if (drive.isLoading) return <Skeleton className="h-96" />;
  const d = drive.data;
  if (!d) return null;
  return (
    <div className="grid gap-5">
      <BackLink to="/admin/placements">{t('placements.admin.backToDrives')}</BackLink>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="eyebrow">{d.company.name}</p>
          <h2 className="text-title font-semibold">{d.title}</h2>
          <p className="text-meta text-fg-2">
            {t(`placements.mode.${d.mode}`)} · {formatDateTime(d.driveDate)}
          </p>
        </div>
        <Badge tone={d.status === 'open' ? 'success' : d.status === 'cancelled' ? 'danger' : 'neutral'}>
          {t(`placements.status.${d.status}`)}
        </Badge>
      </div>
      <StatusActions drive={d} />
      <StatGrid>
        <StatCard label={t('placements.admin.registered')} value={String(d.registrations ?? 0)} />
        <StatCard label={t('placements.admin.closes')} value={formatDateTime(d.registrationCloseAt)} />
        <StatCard label={t('placements.rounds')} value={String(d.rounds.length)} />
      </StatGrid>
      {d.company.notes && (
        <Card className="grid gap-1 p-4">
          <h3 className="text-meta font-semibold">{t('placements.admin.notes')}</h3>
          <p className="text-meta whitespace-pre-line text-fg-2">{d.company.notes}</p>
        </Card>
      )}
      <section aria-labelledby="dm-registrants" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="dm-registrants" className="text-title font-semibold">
            {t('placements.admin.registrants')}
          </h3>
          <div className="flex flex-wrap gap-2">
            {['open', 'closed'].includes(d.status) && (
              <Button size="sm" onClick={() => setDialog('override')}>
                <UserPlus className="size-4" aria-hidden /> {t('placements.admin.letInStudent')}
              </Button>
            )}
            {canExport && (
              <Button size="sm" onClick={() => setDialog('export')}>
                <Download className="size-4" aria-hidden /> {t('placements.admin.export')}
              </Button>
            )}
          </div>
        </div>
        <Registrants drive={d} />
      </section>
      {dialog === 'override' && <OverrideDialog drive={d} onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportDialog drive={d} onClose={() => setDialog(null)} />}
    </div>
  );
}
