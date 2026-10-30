import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, CircleAlert, FileText, MapPin } from 'lucide-react';
import type { DriveView, MyRegistrationView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { Dialog, Sheet } from '../../components/ui/dialog';
import { Field, Select, Textarea } from '../../components/ui/field';
import { Badge, Card, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { RichText } from '../../components/ui/rich-text';
import { api, ApiError } from '../../lib/api';
import { celebrate, firstSighting } from '../../lib/celebrate';
import { formatDateTime, formatRelative, newIdempotencyKey } from '../../lib/format';
import { useCan } from '../../lib/me';
import { ctcRange, DRIVE_KEYS, isRegistered, reasonText } from '../../lib/placements';
import { placementDrive } from '../../lib/queries';
import { findCached, hasId } from '../../lib/query-seed';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import { CompanyMark } from '../jobs/job-card';

type Upload = { id: string; name: string };

/** A PDF upload for a registration (the résumé, or a file the drive asks for). */
function PdfButton({
  label,
  value,
  onDone,
  onError,
}: {
  label: string;
  value: Upload | null;
  onDone: (u: Upload) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const form = new FormData();
      form.append('file', f);
      return { id: (await api.upload<{ id: string }>('/placements/resume', form)).id, name: f.name };
    },
    onSuccess: onDone,
    onError: (e) => onError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <div className="grid gap-1.5">
      <span className="text-meta font-semibold">{label}</span>
      <input
        ref={ref}
        type="file"
        accept="application/pdf"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" loading={upload.isPending} onClick={() => ref.current?.click()}>
          <FileText className="size-4" aria-hidden />{' '}
          {value ? t('placements.replacePdf') : t('placements.addPdf')}
        </Button>
        <span className="text-meta text-fg-2" aria-live="polite">
          {value ? value.name : t('placements.pdfHint')}
        </span>
      </div>
    </div>
  );
}

/** The drive's questions and résumé; drives that ask for neither register in one tap. */
function RegisterSheet({
  drive: d,
  onClose,
  onDone,
}: {
  drive: DriveView;
  onClose: () => void;
  onDone: (r: MyRegistrationView) => void;
}) {
  const { t } = useTranslation();
  const [key] = useState(newIdempotencyKey);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [files, setFiles] = useState<Record<number, Upload>>({});
  const [resume, setResume] = useState<Upload | null>(null);
  const [error, setError] = useState('');
  const send = useMutation({
    mutationFn: () =>
      api.postOnce<MyRegistrationView>(
        `/placements/drives/${d.id}/register`,
        {
          answers: d.questions.flatMap((q, i) => {
            const value = q.kind === 'file' ? files[i]?.id : answers[i]?.trim();
            return value ? [{ question: i, value }] : [];
          }),
          ...(resume ? { resumeFileId: resume.id } : {}),
        },
        key,
      ),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const ready =
    (!d.resumeRequired || !!resume) &&
    d.questions.every((q, i) => !q.required || (q.kind === 'file' ? !!files[i] : !!answers[i]?.trim()));
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('placements.registerFor', { company: d.company.name })}
      description={t('placements.registerBody')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            type="submit"
            form="drive-register"
            loading={send.isPending}
            disabled={!ready}
          >
            {t('placements.register')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <form
        id="drive-register"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) send.mutate();
        }}
      >
        {d.resumeRequired && (
          <PdfButton
            label={t('placements.resume')}
            value={resume}
            onDone={(u) => {
              setError('');
              setResume(u);
            }}
            onError={setError}
          />
        )}
        {d.questions.map((q, i) =>
          q.kind === 'file' ? (
            <PdfButton
              key={i}
              label={q.label}
              value={files[i] ?? null}
              onDone={(u) => {
                setError('');
                setFiles((f) => ({ ...f, [i]: u }));
              }}
              onError={setError}
            />
          ) : (
            <Field key={i} label={q.label} aside={q.required ? undefined : t('common.optional')}>
              {({ id }) =>
                q.kind === 'choice' ? (
                  <Select
                    id={id}
                    required={q.required}
                    value={answers[i] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                  >
                    <option value="">{t('placements.choose')}</option>
                    {q.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Textarea
                    id={id}
                    required={q.required}
                    maxLength={2000}
                    value={answers[i] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                  />
                )
              }
            </Field>
          ),
        )}
        {error && (
          <p role="alert" className="text-meta font-medium text-danger">
            {error}
          </p>
        )}
        <p className="text-caption text-fg-3">{t('placements.sharedWith')}</p>
      </form>
    </Sheet>
  );
}

/** Where the student stands: register, registered (and how it went), or why not. */
function RegistrationPanel({ drive: d }: { drive: DriveView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canRegister = useCan('placements:register');
  const [sheet, setSheet] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const reg = d.myRegistration;
  const registered = isRegistered(d);
  const update = (r: MyRegistrationView) => {
    qc.setQueryData<DriveView>(['placement-drive', d.id], (v) => (v ? { ...v, myRegistration: r } : v));
    for (const queryKey of DRIVE_KEYS) void qc.invalidateQueries({ queryKey });
  };
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const quick = useMutation({
    mutationFn: () =>
      api.postOnce<MyRegistrationView>(`/placements/drives/${d.id}/register`, {}, newIdempotencyKey()),
    onSuccess: (r) => {
      update(r);
      toast.success(t('placements.registeredToast', { company: d.company.name }));
    },
    onError: fail,
  });
  const withdraw = useMutation({
    mutationFn: () => api.post<MyRegistrationView>(`/placements/drives/${d.id}/withdraw`, {}),
    onSuccess: (r) => {
      setConfirmWithdraw(false);
      update(r);
    },
    onError: fail,
  });
  // Being selected is a moment (ADR 0008): celebrated once per device.
  const selectedId = reg?.final === 'selected' ? reg.id : '';
  useEffect(() => {
    if (selectedId && firstSighting('drive-selected', [selectedId])) celebrate(panelRef.current);
  }, [selectedId]);
  const oneTap = !d.resumeRequired && !d.questions.length;
  return (
    <div ref={panelRef}>
      <Card variant="raised" className="grid gap-3 p-4">
        {registered && reg ? (
          <>
            <p className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="size-5 text-success" aria-hidden />
              {reg.final === 'selected'
                ? t('placements.youWereSelected')
                : reg.final === 'not_selected'
                  ? t('placements.final.not_selected')
                  : t('placements.youAreRegistered')}
            </p>
            {reg.status === 'tpo_override' && <p className="text-meta text-fg-2">{t('placements.letIn')}</p>}
            {reg.final === 'selected' && (
              <Link
                to="/placements?tab=offers"
                className="text-meta font-semibold text-brand-ink hover:underline"
              >
                {t('placements.seeOffer')}
              </Link>
            )}
            {d.registrationOpen && reg.final === 'in_process' && canRegister && (
              <div>
                <Button size="sm" variant="ghost" onClick={() => setConfirmWithdraw(true)}>
                  {t('placements.withdraw')}
                </Button>
              </div>
            )}
          </>
        ) : d.registrationOpen ? (
          d.eligible || d.overridden ? (
            <>
              <p className="font-semibold">
                {d.overridden && !d.eligible
                  ? t('placements.letInCanRegister')
                  : t('placements.youAreEligible')}
              </p>
              <p className="text-meta text-fg-2">
                {t('placements.closesAt', { when: formatDateTime(d.registrationCloseAt) })} ·{' '}
                {formatRelative(d.registrationCloseAt)}
              </p>
              {canRegister && (
                <Button
                  variant="primary"
                  loading={quick.isPending}
                  onClick={() => (oneTap ? quick.mutate() : setSheet(true))}
                >
                  {oneTap ? t('placements.registerOneTap') : t('placements.register')}
                </Button>
              )}
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 font-semibold">
                <CircleAlert className="size-5 text-warning" aria-hidden /> {t('placements.notEligibleTitle')}
              </p>
              <ul className="ml-5 grid list-disc gap-1 text-meta text-fg-2">
                {d.reasons.map((r, i) => (
                  <li key={i}>{reasonText(t, r)}</li>
                ))}
              </ul>
              <p className="text-caption text-fg-3">{t('placements.notEligibleHelp')}</p>
            </>
          )
        ) : (
          <p className="text-meta text-fg-2">
            {d.status === 'cancelled' ? t('placements.cancelledNote') : t('placements.registrationClosed')}
          </p>
        )}
        {sheet && (
          <RegisterSheet
            drive={d}
            onClose={() => setSheet(false)}
            onDone={(r) => {
              setSheet(false);
              update(r);
              toast.success(t('placements.registeredToast', { company: d.company.name }));
            }}
          />
        )}
        <Dialog
          open={confirmWithdraw}
          onOpenChange={setConfirmWithdraw}
          title={t('placements.withdrawTitle')}
          description={t('placements.withdrawBody', { company: d.company.name })}
        >
          <div className="grid gap-2 sm:flex sm:flex-row-reverse">
            <Button variant="danger" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
              {t('placements.withdraw')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmWithdraw(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Dialog>
      </Card>
    </div>
  );
}

/** The criteria in words (only those the drive sets). */
function Criteria({ drive: d }: { drive: DriveView }) {
  const { t } = useTranslation();
  const e = d.eligibility;
  const rows: string[] = [
    e.branches.length ? t('placements.crit.branches', { list: e.branches.join(', ') }) : '',
    e.gradYears.length ? t('placements.crit.gradYears', { list: e.gradYears.join(', ') }) : '',
    e.minCgpa !== null ? t('placements.crit.cgpa', { n: e.minCgpa }) : '',
    e.maxActiveBacklogs !== null ? t('placements.crit.activeBacklogs', { count: e.maxActiveBacklogs }) : '',
    e.maxHistoryBacklogs !== null
      ? t('placements.crit.historyBacklogs', { count: e.maxHistoryBacklogs })
      : '',
    e.minTenthPct !== null ? t('placements.crit.tenth', { n: e.minTenthPct }) : '',
    e.minTwelfthPct !== null ? t('placements.crit.twelfth', { n: e.minTwelfthPct }) : '',
  ].filter(Boolean);
  return (
    <section aria-labelledby="drive-criteria" className="grid gap-2">
      <h2 id="drive-criteria" className="text-title font-semibold">
        {t('placements.criteria')}
      </h2>
      {rows.length ? (
        <ul className="ml-5 grid list-disc gap-1 text-fg-2">
          {rows.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : (
        <p className="text-fg-2">{t('placements.critOpen')}</p>
      )}
    </section>
  );
}

/** A drive: roles and pay, who may apply, rounds (with the student's results) and registration. */
export function DrivePage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    ...SCREEN,
    ...placementDrive(id),
    placeholderData: () =>
      findCached(qc, [['placement-drives']], hasId<DriveView>('id', id, ['company', 'roles', 'eligibility'])),
  });
  if (q.isLoading) return <Skeleton className="h-80" />;
  const d = q.data;
  if (!d) return null;
  const results = new Map((d.myRegistration?.roundResults ?? []).map((r) => [r.round, r.result]));
  const tone = { pending: 'neutral', cleared: 'success', not_cleared: 'danger', absent: 'warning' } as const;
  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-5">
      <BackLink to="/placements">{t('placements.back')}</BackLink>
      <header className="flex items-start gap-4">
        <CompanyMark name={d.company.name} size="lg" />
        <PageHeader
          as="div"
          className="min-w-0 flex-1"
          eyebrow={d.company.name}
          title={d.title}
          intro={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{t(`placements.mode.${d.mode}`)}</span>
              {d.venue && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-4" aria-hidden /> {d.venue}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="size-4" aria-hidden /> {formatDateTime(d.driveDate)}
              </span>
            </span>
          }
        />
      </header>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="grid min-w-0 gap-6">
          <section aria-labelledby="drive-roles" className="grid gap-2">
            <h2 id="drive-roles" className="text-title font-semibold">
              {t('placements.roles')}
            </h2>
            <ul className="grid gap-2">
              {d.roles.map((r, i) => (
                <li key={i}>
                  <Card className="flex flex-wrap items-center justify-between gap-2 p-3.5">
                    <div className="min-w-0">
                      <p className="font-semibold">{r.title}</p>
                      <p className="text-meta text-fg-2">
                        {[t(`placements.roleType.${r.type}`), r.location].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {ctcRange(t, r) && <Badge tone="brand">{ctcRange(t, r)}</Badge>}
                  </Card>
                </li>
              ))}
            </ul>
          </section>
          {d.description && (
            <section aria-labelledby="drive-about" className="grid gap-2">
              <h2 id="drive-about" className="text-title font-semibold">
                {t('placements.about')}
              </h2>
              <RichText text={d.description} />
            </section>
          )}
          <Criteria drive={d} />
          {d.rounds.length > 0 && (
            <section aria-labelledby="drive-rounds" className="grid gap-2">
              <h2 id="drive-rounds" className="text-title font-semibold">
                {t('placements.rounds')}
              </h2>
              <ol className="grid gap-2">
                {d.rounds.map((r, i) => {
                  const mine = results.get(i);
                  return (
                    <li
                      key={i}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-surface-2 p-3"
                    >
                      <span className="min-w-0">
                        <b className="font-semibold">
                          {i + 1}. {r.name}
                        </b>{' '}
                        <span className="text-meta text-fg-2">
                          · {t(`placements.roundKind.${r.kind}`)}
                          {r.at ? ` · ${formatDateTime(r.at)}` : ''}
                        </span>
                      </span>
                      {mine && isRegistered(d) && (
                        <Badge tone={tone[mine]}>{t(`placements.result.${mine}`)}</Badge>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </div>
        <aside className="grid gap-3 lg:sticky lg:top-5">
          <RegistrationPanel drive={d} />
          {d.linkedEventId && (
            <Link
              to={`/events/${d.linkedEventId}`}
              className="text-meta font-semibold text-brand-ink hover:underline"
            >
              {t('placements.seeEvent')}
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}
