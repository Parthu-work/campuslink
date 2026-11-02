import { useState } from 'react';
import { useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, MessageCircle, Plus, Printer, QrCode } from 'lucide-react';
import { BRANCHES, type InviteSendResult, type JoinCodeView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Checkbox, Field, Input, Select } from '../../components/ui/field';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Chip, EmptyState, Skeleton } from '../../components/ui/misc';
import { Dialog } from '../../components/ui/dialog';
import { IntentLink } from '../../components/ui/intent-link';
import { Table, THead, Td, Th } from '../../components/ui/table';
import { FormError } from '../../components/layout/auth-layout';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useFeature } from '../../lib/tenant-context';
import { downloadCsv } from '../../lib/csv';
import * as q from '../../lib/queries';

type Kind = '' | 'student' | 'alumni';
type Links = InviteSendResult & { links: { rollNumber: string; name: string; link: string }[] };

/**
 * Admin › Onboarding (B4): who on the college's list has not joined yet, personal invite links
 * (WhatsApp, or a CSV for the college's own mail merge) and class join codes with posters.
 */
export function OnboardingAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const whatsapp = useFeature('whatsapp');
  const [branch, setBranch] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [kind, setKind] = useState<Kind>('');
  const [sending, setSending] = useState(false);
  const year = /^\d{4}$/.test(gradYear) ? Number(gradYear) : undefined;
  const filters = {
    ...(branch ? { branch } : {}),
    ...(year ? { gradYear: year } : {}),
    ...(kind ? { kind } : {}),
  };
  const qs = new URLSearchParams(
    Object.entries(filters).map(([k, v]) => [k, String(v)] as [string, string]),
  ).toString();
  const list = useInfiniteQuery(q.onboardingRecords(qs));
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  const csv = useMutation({
    mutationFn: () => api.post<Links>('/admin/onboarding/invites', { ...filters, channel: 'csv' }),
    onSuccess: (r) => {
      if (r.links.length)
        downloadCsv(
          'invite-links.csv',
          [t('admin.rollNumber'), t('common.name'), t('onboarding.link')],
          r.links.map((l) => [l.rollNumber, l.name, l.link]),
        );
      toast.success(t('onboarding.csvDone', { count: r.created, skipped: r.skipped }));
      void qc.invalidateQueries({ queryKey: ['onboarding-records'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-6">
      <Progress />
      <section className="grid gap-4" aria-labelledby="onb-records">
        <div className="grid gap-1">
          <h2 id="onb-records" className="text-title font-semibold">
            {t('onboarding.notJoined')}
          </h2>
          <p className="text-fg-2">{t('onboarding.intro')}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('admin.field.branch')}>
            {({ id }) => (
              <Select id={id} value={branch} onChange={(e) => setBranch(e.target.value)}>
                <option value="">{t('onboarding.anyBranch')}</option>
                {BRANCHES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('admin.field.gradYear')}>
            {({ id }) => (
              <Input
                id={id}
                inputMode="numeric"
                maxLength={4}
                value={gradYear}
                onChange={(e) => setGradYear(e.target.value.replace(/\D/g, ''))}
              />
            )}
          </Field>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-meta font-semibold">{t('admin.kindField')}</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['', t('onboarding.anyKind')],
                  ['student', t('admin.kind.student')],
                  ['alumni', t('admin.kind.alumni')],
                ] as const
              ).map(([v, l]) => (
                <Chip key={v} pressed={kind === v} onClick={() => setKind(v)}>
                  {l}
                </Chip>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="flex flex-wrap gap-2">
          {whatsapp && (
            <Button variant="primary" onClick={() => setSending(true)} disabled={!rows.length}>
              <MessageCircle className="size-4" aria-hidden /> {t('onboarding.sendWhatsApp')}
            </Button>
          )}
          <Button onClick={() => csv.mutate()} loading={csv.isPending} disabled={!rows.length}>
            <Download className="size-4" aria-hidden /> {t('onboarding.downloadCsv')}
          </Button>
        </div>
        <p className="text-caption text-fg-3">{t('onboarding.resendRule')}</p>
        {list.isLoading && <Skeleton className="h-48" />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.isSuccess && !rows.length && (
          <EmptyState art={<Illustration kind="done" />} title={t('onboarding.allJoined')} />
        )}
        {rows.length > 0 && (
          <Table label={t('onboarding.notJoined')}>
            <THead>
              <tr>
                <Th>{t('admin.rollNumber')}</Th>
                <Th>{t('common.name')}</Th>
                <Th>{t('onboarding.class')}</Th>
                <Th>{t('onboarding.contact')}</Th>
                <Th>{t('onboarding.lastInvited')}</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="font-mono">{r.rollNumber}</Td>
                  <Td>{r.name}</Td>
                  <Td>
                    {[r.branch, r.gradYear].filter(Boolean).join(' · ')}{' '}
                    {r.kind === 'alumni' && <Badge>{t('admin.kind.alumni')}</Badge>}
                  </Td>
                  <Td>
                    {[r.hasPhone && t('onboarding.phone'), r.hasEmail && t('common.email')]
                      .filter(Boolean)
                      .join(', ') || t('onboarding.noContact')}
                  </Td>
                  <Td>{r.lastInvitedAt ? new Date(r.lastInvitedAt).toLocaleDateString() : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.hasNextPage && (
          <Button onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
            {t('common.loadMore')}
          </Button>
        )}
      </section>
      <JoinCodes />
      <SendDialog
        open={sending}
        onOpenChange={setSending}
        filters={filters}
        onSent={() => void qc.invalidateQueries({ queryKey: ['onboarding-records'] })}
      />
    </div>
  );
}

/** B6: each branch and batch from the list to active members, with a one-tap WhatsApp nudge. */
function Progress() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const whatsapp = useFeature('whatsapp');
  const rows = useQuery(q.onboardingProgress());
  const [nudging, setNudging] = useState<{ branch: string; gradYear: number } | null>(null);
  const [attest, setAttest] = useState(false);
  const nudge = useMutation({
    mutationFn: (c: { branch: string; gradYear: number }) =>
      api.post<Links>('/admin/onboarding/nudge', { ...c, attestOptIn: true }),
    onSuccess: (r) => {
      toast.success(t('onboarding.sentDone', { count: r.sent, skipped: r.skipped, failed: r.failed }));
      setNudging(null);
      setAttest(false);
      void qc.invalidateQueries({ queryKey: ['onboarding-progress'] });
      void qc.invalidateQueries({ queryKey: ['onboarding-records'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');
  return (
    <section className="grid gap-4" aria-labelledby="onb-progress">
      <div className="grid gap-1">
        <h2 id="onb-progress" className="text-title font-semibold">
          {t('onboarding.progressTitle')}
        </h2>
        <p className="text-fg-2">{t('onboarding.progressIntro')}</p>
      </div>
      {rows.isLoading && <Skeleton className="h-32" />}
      {rows.isError && <ErrorState error={rows.error} onRetry={() => void rows.refetch()} compact />}
      {rows.isSuccess && rows.data.length > 0 && (
        <Table label={t('onboarding.progressTitle')}>
          <THead>
            <tr>
              <Th>{t('onboarding.class')}</Th>
              <Th>{t('onboarding.onList')}</Th>
              <Th>{t('onboarding.invited')}</Th>
              <Th>{t('onboarding.joined')}</Th>
              <Th>{t('onboarding.verified')}</Th>
              <Th>{t('onboarding.active7d')}</Th>
              {whatsapp && (
                <Th>
                  <span className="sr-only">{t('onboarding.actions')}</span>
                </Th>
              )}
            </tr>
          </THead>
          <tbody>
            {rows.data.map((r) => (
              <tr key={`${r.branch}-${r.gradYear}`}>
                <Td>{[r.branch, r.gradYear].filter(Boolean).join(' · ') || '—'}</Td>
                <Td>{r.roster}</Td>
                <Td>{r.invited}</Td>
                <Td>
                  {r.claimed} <span className="text-fg-3">({pct(r.claimed, r.roster)})</span>
                </Td>
                <Td>{r.verified}</Td>
                <Td>{r.active7d}</Td>
                {whatsapp && (
                  <Td>
                    {r.branch && r.gradYear && r.claimed < r.roster && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setNudging({ branch: r.branch ?? '', gradYear: r.gradYear ?? 0 })}
                      >
                        <MessageCircle className="size-4" aria-hidden /> {t('onboarding.nudge')}
                      </Button>
                    )}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog
        open={!!nudging}
        onOpenChange={(o) => !o && setNudging(null)}
        title={t('onboarding.nudgeTitle', {
          class: nudging ? `${nudging.branch} · ${nudging.gradYear}` : '',
        })}
        description={t('onboarding.sendIntro')}
        footer={
          <Button
            variant="primary"
            disabled={!attest}
            loading={nudge.isPending}
            onClick={() => nudging && nudge.mutate(nudging)}
          >
            {t('onboarding.sendNow')}
          </Button>
        }
      >
        <div className="grid gap-4">
          <Checkbox id="attest-nudge" checked={attest} onChange={setAttest}>
            {t('onboarding.attest')}
          </Checkbox>
          <p className="text-caption text-fg-3">{t('onboarding.resendRule')}</p>
        </div>
      </Dialog>
    </section>
  );
}

/** WhatsApp invites need the college's word that these people agreed to hear from it there. */
function SendDialog({
  open,
  onOpenChange,
  filters,
  onSent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  filters: Record<string, string | number>;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const [attest, setAttest] = useState(false);
  const send = useMutation({
    mutationFn: () =>
      api.post<Links>('/admin/onboarding/invites', { ...filters, channel: 'whatsapp', attestOptIn: true }),
    onSuccess: (r) => {
      toast.success(t('onboarding.sentDone', { count: r.sent, skipped: r.skipped, failed: r.failed }));
      onSent();
      onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('onboarding.sendWhatsApp')}
      description={t('onboarding.sendIntro')}
      footer={
        <Button variant="primary" disabled={!attest} loading={send.isPending} onClick={() => send.mutate()}>
          {t('onboarding.sendNow')}
        </Button>
      }
    >
      <div className="grid gap-4">
        <FormError message={send.error instanceof ApiError ? send.error.message : undefined} />
        <Checkbox id="attest-optin" checked={attest} onChange={setAttest}>
          {t('onboarding.attest')}
        </Checkbox>
        <p className="text-caption text-fg-3">{t('onboarding.sendCost')}</p>
      </div>
    </Dialog>
  );
}

function JoinCodes() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const codes = useQuery(q.joinCodes());
  const [creating, setCreating] = useState(false);
  const stop = useMutation({
    mutationFn: (id: string) => api.post<JoinCodeView>(`/admin/join-codes/${id}/expire`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['join-codes'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section className="grid gap-4" aria-labelledby="onb-codes">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid min-w-0 flex-[1_1_16rem] gap-1">
          <h2 id="onb-codes" className="text-title font-semibold">
            {t('onboarding.codesTitle')}
          </h2>
          <p className="text-fg-2">{t('onboarding.codesIntro')}</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden /> {t('onboarding.newCode')}
        </Button>
      </div>
      {codes.isLoading && <Skeleton className="h-32" />}
      {codes.isError && <ErrorState error={codes.error} onRetry={() => void codes.refetch()} compact />}
      {codes.isSuccess && !codes.data.length && (
        <EmptyState icon={<QrCode className="size-6" />} title={t('onboarding.noCodes')} />
      )}
      {codes.isSuccess && codes.data.length > 0 && (
        <Table label={t('onboarding.codesTitle')}>
          <THead>
            <tr>
              <Th>{t('onboarding.code')}</Th>
              <Th>{t('onboarding.class')}</Th>
              <Th>{t('onboarding.uses')}</Th>
              <Th>{t('onboarding.expires')}</Th>
              <Th>
                <span className="sr-only">{t('onboarding.actions')}</span>
              </Th>
            </tr>
          </THead>
          <tbody>
            {codes.data.map((c) => (
              <tr key={c.id}>
                <Td className="font-mono tracking-widest">{c.code}</Td>
                <Td>{[t(`admin.kind.${c.kind}`), c.branch, c.gradYear].filter(Boolean).join(' · ')}</Td>
                <Td>{c.uses}</Td>
                <Td>
                  {c.active ? (
                    new Date(c.expiresAt).toLocaleDateString()
                  ) : (
                    <Badge>{t('onboarding.stopped')}</Badge>
                  )}
                </Td>
                <Td>
                  {c.active && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <IntentLink
                        to={`/admin/onboarding/poster/${c.id}`}
                        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                      >
                        <Printer className="size-4" aria-hidden /> {t('onboarding.poster')}
                      </IntentLink>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={stop.isPending && stop.variables === c.id}
                        onClick={() => stop.mutate(c.id)}
                      >
                        {t('onboarding.stop')}
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <NewCodeDialog open={creating} onOpenChange={setCreating} />
    </section>
  );
}

function NewCodeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [kind, setKind] = useState<'student' | 'alumni'>('student');
  const [branch, setBranch] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [days, setDays] = useState('14');
  const create = useMutation({
    mutationFn: () =>
      api.post<JoinCodeView>('/admin/join-codes', {
        kind,
        ...(branch ? { branch } : {}),
        ...(/^\d{4}$/.test(gradYear) ? { gradYear: Number(gradYear) } : {}),
        days: Math.min(60, Math.max(1, Number(days) || 14)),
      }),
    onSuccess: (c) => {
      toast.success(t('onboarding.codeCreated', { code: c.code }));
      void qc.invalidateQueries({ queryKey: ['join-codes'] });
      onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('onboarding.newCode')}
      description={t('onboarding.newCodeIntro')}
      footer={
        <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
          {t('onboarding.createCode')}
        </Button>
      }
    >
      <div className="grid gap-4">
        <FormError message={create.error instanceof ApiError ? create.error.message : undefined} />
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-meta font-semibold">{t('admin.kindField')}</legend>
          <div className="flex gap-2">
            {(['student', 'alumni'] as const).map((k) => (
              <Chip key={k} pressed={kind === k} onClick={() => setKind(k)}>
                {t(`admin.kind.${k}`)}
              </Chip>
            ))}
          </div>
        </fieldset>
        <Field label={t('admin.field.branch')}>
          {({ id }) => (
            <Select id={id} value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">{t('onboarding.anyBranch')}</option>
              {BRANCHES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('admin.field.gradYear')}>
          {({ id }) => (
            <Input
              id={id}
              inputMode="numeric"
              maxLength={4}
              value={gradYear}
              onChange={(e) => setGradYear(e.target.value.replace(/\D/g, ''))}
            />
          )}
        </Field>
        <Field label={t('onboarding.days')} hint={t('onboarding.daysHint')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              inputMode="numeric"
              maxLength={2}
              aria-describedby={describedBy}
              value={days}
              onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/** `/admin/onboarding/poster/:id`: a printable A4 poster with the class code and its QR code. */
export function JoinPosterPage() {
  const { t } = useTranslation();
  const id = useParams().id ?? '';
  const poster = useQuery(q.joinCodePoster(id));
  if (poster.isLoading) return <Skeleton className="h-96" />;
  if (poster.isError) return <ErrorState error={poster.error} onRetry={() => void poster.refetch()} />;
  const p = poster.data;
  if (!p) return null;
  const cls = [t(`admin.kind.${p.kind}`), p.branch, p.gradYear].filter(Boolean).join(' · ');
  return (
    <div className="grid gap-4">
      <div className="flex justify-end print:hidden">
        <Button variant="primary" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden /> {t('onboarding.print')}
        </Button>
      </div>
      <article className="mx-auto grid w-full max-w-[640px] justify-items-center gap-5 rounded-[var(--radius-xl)] border border-line bg-surface-1 p-8 text-center print:fixed print:inset-0 print:z-[999] print:max-w-none print:rounded-none print:border-0">
        <div className="grid gap-1">
          <h2 className="text-headline font-bold">{t('onboarding.posterTitle', { college: p.college })}</h2>
          <p className="text-lead text-fg-2">{cls}</p>
        </div>
        <img
          src={`data:image/svg+xml;base64,${btoa(p.qrSvg)}`}
          alt={t('onboarding.qrAlt')}
          width={280}
          height={280}
          className="rounded-[var(--radius-md)] bg-surface-1"
        />
        <p className="text-meta text-fg-2">{t('onboarding.posterScan')}</p>
        <p className="font-mono text-title tracking-[0.3em]">{p.code}</p>
        <p className="text-meta break-all text-fg-2">{p.url}</p>
        <p className="text-caption text-fg-3">
          {t('onboarding.posterValid', { date: new Date(p.expiresAt).toLocaleDateString() })}
        </p>
      </article>
    </div>
  );
}
