import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, HandHeart, Plus, Upload, Users } from 'lucide-react';
import {
  BRANCHES,
  MICRO_ASK_KINDS,
  type Branch,
  type LinkedinPreview,
  type MicroAskKind,
  type MicroAskView,
  type PledgeView,
  type PublicProfile,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/field';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { ProgressBar } from '../../components/ui/progress';
import { Switch } from '../../components/ui/switch';
import { Segmented } from '../../components/ui/tab-nav';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { api, ApiError, apiBlob, saveBlob } from '../../lib/api';
import { rupees, toPaise } from '../../lib/billing';
import { formatDay, newIdempotencyKey } from '../../lib/format';
import { useCan } from '../../lib/me';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/cn';

const fail = (t: (k: string) => string) => (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
const STATUS_TONE = {
  routing: 'info',
  assigned: 'info',
  accepted: 'brand',
  done: 'success',
  unmatched: 'neutral',
  cancelled: 'neutral',
} as const;
const PLEDGE_TONE = { pledged: 'info', paid: 'brand', received: 'success', cancelled: 'neutral' } as const;

/** A question link (`…/questions/<id>`) or a bare id, as the id. */
const questionIdOf = (s: string) => /([a-f0-9]{24})\s*$/i.exec(s.trim())?.[1] ?? '';

// ── Micro-asks ─────────────────────────────

function AskDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [kind, setKind] = useState<MicroAskKind>('review_resume');
  const [company, setCompany] = useState('');
  const [branch, setBranch] = useState<Branch | ''>('');
  const [topic, setTopic] = useState('');
  const [resumeId, setResumeId] = useState('');
  const [question, setQuestion] = useState('');
  const [note, setNote] = useState('');
  const [key] = useState(newIdempotencyKey);
  const resumes = useQuery({ ...q.resumes(), enabled: kind === 'review_resume' });
  const send = useMutation({
    mutationFn: () =>
      api.postOnce<MicroAskView>(
        '/micro-asks',
        {
          kind,
          audience: {
            ...(company.trim() ? { company: company.trim() } : {}),
            ...(branch ? { branch } : {}),
            ...(topic.trim() ? { topic: topic.trim() } : {}),
          },
          ...(kind === 'review_resume' ? { resumeId } : {}),
          ...(kind === 'answer_question' ? { questionId: questionIdOf(question) } : {}),
          note: note.trim(),
        },
        key,
      ),
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: ['micro-asks'] });
      toast.success(a.status === 'unmatched' ? t('alumni.asks.unmatched') : t('alumni.asks.sent'));
      onClose();
    },
    onError: fail(t),
  });
  const ready =
    note.trim().length >= 10 &&
    (kind !== 'review_resume' || !!resumeId) &&
    (kind !== 'answer_question' || !!questionIdOf(question));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('alumni.asks.newTitle')}
      description={t('alumni.asks.newBody')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button variant="primary" type="submit" form="micro-ask" loading={send.isPending} disabled={!ready}>
            {t('alumni.asks.send')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <form
        id="micro-ask"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) send.mutate();
        }}
      >
        <ChoiceGroup
          label={t('alumni.asks.kindLabel')}
          value={kind}
          onChange={setKind}
          options={MICRO_ASK_KINDS.map((k) => ({ value: k, label: t(`alumni.kind.${k}`) }))}
        />
        {kind === 'review_resume' && (
          <Field label={t('alumni.asks.resume')}>
            {({ id }) => (
              <Select id={id} value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
                <option value="">{t('alumni.asks.pickResume')}</option>
                {(resumes.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {kind === 'answer_question' && (
          <Field label={t('alumni.asks.question')} hint={t('alumni.asks.questionHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
            )}
          </Field>
        )}
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-callout font-semibold">{t('alumni.asks.who')}</legend>
          <Field label={t('alumni.asks.company')}>
            {({ id }) => (
              <Input id={id} maxLength={80} value={company} onChange={(e) => setCompany(e.target.value)} />
            )}
          </Field>
          <Field label={t('alumni.asks.branch')}>
            {({ id }) => (
              <Select id={id} value={branch} onChange={(e) => setBranch(e.target.value as Branch | '')}>
                <option value="">{t('alumni.asks.anyBranch')}</option>
                {BRANCHES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('alumni.asks.topic')}>
            {({ id }) => (
              <Input id={id} maxLength={40} value={topic} onChange={(e) => setTopic(e.target.value)} />
            )}
          </Field>
        </fieldset>
        <Field label={t('alumni.asks.note')} hint={t('alumni.asks.noteHint')}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

function AskCard({ a }: { a: MicroAskView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (action: 'accept' | 'decline' | 'done' | 'cancel') =>
      action === 'cancel'
        ? api.post<MicroAskView>(`/micro-asks/${a.id}/cancel`)
        : api.post<MicroAskView>(`/micro-asks/${a.id}/reply`, { action }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['micro-asks'] }),
    onError: fail(t),
  });
  const open = a.status === 'assigned' || a.status === 'accepted';
  const who = [a.audience.company, a.audience.branch, a.audience.topic].filter(Boolean).join(' · ');
  return (
    <li>
      <Card className="grid gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{t(`alumni.kind.${a.kind}`)}</span>
          <Badge tone={STATUS_TONE[a.status]}>{t(`alumni.status.${a.status}`)}</Badge>
        </div>
        <p className="text-callout text-fg-2">
          {a.role === 'helper'
            ? t('alumni.asks.from', { name: a.asker.name })
            : a.helper
              ? t('alumni.asks.with', { name: a.helper.name })
              : who || t('alumni.asks.anyone')}
        </p>
        <p className="whitespace-pre-line">{a.note}</p>
        {a.role === 'helper' && a.resumeId && (
          <Link to={`/resume/${a.resumeId}`} className="text-callout font-semibold text-brand-ink underline">
            {t('alumni.asks.openResume')}
          </Link>
        )}
        {a.questionId && (
          <Link
            to={`/questions/${a.questionId}`}
            className="text-callout font-semibold text-brand-ink underline"
          >
            {t('alumni.asks.openQuestion')}
          </Link>
        )}
        {a.expiresAt && a.role === 'helper' && (
          <p className="text-caption text-fg-3">
            {t('alumni.asks.replyBy', { date: formatDay(a.expiresAt) })}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {a.role === 'helper' && a.status === 'assigned' && (
            <Button size="sm" variant="primary" loading={act.isPending} onClick={() => act.mutate('accept')}>
              {t('alumni.asks.accept')}
            </Button>
          )}
          {a.role === 'helper' && open && (
            <>
              <Button size="sm" loading={act.isPending} onClick={() => act.mutate('done')}>
                {t('alumni.asks.done')}
              </Button>
              <Button size="sm" variant="ghost" loading={act.isPending} onClick={() => act.mutate('decline')}>
                {t('alumni.asks.pass')}
              </Button>
            </>
          )}
          {a.role === 'asker' && (open || a.status === 'routing') && (
            <Button size="sm" variant="ghost" loading={act.isPending} onClick={() => act.mutate('cancel')}>
              {t('alumni.asks.withdraw')}
            </Button>
          )}
        </div>
      </Card>
    </li>
  );
}

function AsksPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canAsk = useCan('alumni:ask');
  const canHelp = useCan('alumni:help');
  const [params, setParams] = useSearchParams();
  const box: 'sent' | 'received' =
    canHelp && (params.get('box') === 'received' || !canAsk) ? 'received' : 'sent';
  const [asking, setAsking] = useState(false);
  const list = useQuery({ ...q.microAsks(box), enabled: box === 'sent' ? canAsk : canHelp });
  const settings = useQuery({
    queryKey: ['micro-ask-settings'],
    queryFn: () => api.get<{ open: boolean }>('/me/micro-asks/settings'),
    enabled: canHelp,
  });
  const setOpen = useMutation({
    mutationFn: (open: boolean) => api.put<{ open: boolean }>('/me/micro-asks/settings', { open }),
    onSuccess: (s) => qc.setQueryData(['micro-ask-settings'], s),
    onError: fail(t),
  });
  return (
    <div className="grid gap-4">
      <p className="max-w-[60ch] text-fg-2">{t('alumni.asks.intro')}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {canAsk && canHelp && (
          <Segmented
            label={t('alumni.asks.box')}
            value={box}
            options={[
              ['sent', t('alumni.asks.sentBox')],
              ['received', t('alumni.asks.receivedBox')],
            ]}
            onChange={(v) => {
              const next = new URLSearchParams(params);
              next.set('box', v);
              setParams(next, { replace: true });
            }}
          />
        )}
        {canAsk && box === 'sent' && (
          <Button variant="primary" onClick={() => setAsking(true)}>
            <Plus className="size-4" aria-hidden /> {t('alumni.asks.new')}
          </Button>
        )}
      </div>
      {box === 'received' && settings.data && (
        <Card className="grid gap-2 p-4">
          <Switch
            checked={settings.data.open}
            onChange={(v) => setOpen.mutate(v)}
            label={t('alumni.asks.takeAsks')}
            description={t('alumni.asks.takeAsksHint', {
              received: list.data?.week.received ?? 0,
              cap: list.data?.week.cap ?? 2,
            })}
          />
        </Card>
      )}
      {list.isLoading && <Skeleton className="h-40" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} compact />}
      {list.data &&
        (list.data.asks.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {list.data.asks.map((a) => (
              <AskCard key={a.id} a={a} />
            ))}
          </ul>
        ) : (
          <EmptyState art={<Illustration kind="empty" />} title={t(`alumni.asks.empty.${box}`)} />
        ))}
      {asking && <AskDialog onClose={() => setAsking(false)} />}
    </div>
  );
}

// ── Certificates and recognition ─────────────────────────────

function CertificatesPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const data = useQuery(q.myCertificates());
  const nominations = useQuery(q.myNominations());
  const [busy, setBusy] = useState('');
  const issue = useMutation({
    mutationFn: (academicYear: string) =>
      api.postOnce('/me/certificates', { academicYear }, newIdempotencyKey()),
    onSuccess: () => {
      toast.success(t('alumni.certs.issued'));
      void qc.invalidateQueries({ queryKey: ['certificates'] });
    },
    onError: fail(t),
  });
  const reply = useMutation({
    mutationFn: (v: { id: string; accept: boolean }) =>
      api.post(`/me/alumni-of-the-month/${v.id}`, { accept: v.accept }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['nominations'] }),
    onError: fail(t),
  });
  const download = async (id: string, ay: string) => {
    setBusy(id);
    try {
      saveBlob(await apiBlob(`/me/certificates/${id}/pdf`), `mentorship-${ay}.pdf`);
    } catch (e) {
      fail(t)(e);
    } finally {
      setBusy('');
    }
  };
  const verifyLink = (code: string) => `${window.location.origin}/verify-certificate/${code}`;
  return (
    <div className="grid gap-5">
      <p className="max-w-[60ch] text-fg-2">{t('alumni.certs.intro')}</p>
      {nominations.data
        ?.filter((n) => n.status === 'proposed')
        .map((n) => (
          <Card key={n.id} className="grid gap-2 p-4">
            <p className="font-semibold">{t('alumni.ofMonth.nominated', { month: n.month })}</p>
            <p className="text-callout text-fg-2">{n.citation}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => reply.mutate({ id: n.id, accept: true })}>
                {t('alumni.ofMonth.accept')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => reply.mutate({ id: n.id, accept: false })}>
                {t('alumni.ofMonth.decline')}
              </Button>
            </div>
          </Card>
        ))}
      {data.isLoading && <Skeleton className="h-40" />}
      {data.isError && <ErrorState error={data.error} onRetry={() => void data.refetch()} compact />}
      {data.data && (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.data.years.map((y) => {
            const c = data.data.certificates.find((x) => x.academicYear === y.academicYear);
            return (
              <li key={y.academicYear}>
                <Card className="grid gap-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{t('alumni.certs.year', { year: y.academicYear })}</span>
                    {c && (
                      <Badge tone={c.status === 'revoked' ? 'danger' : 'success'}>
                        {t(`alumni.certs.status.${c.status}`)}
                      </Badge>
                    )}
                  </div>
                  <p className="text-callout text-fg-2">
                    {t('alumni.certs.counts', {
                      sessions: y.sessions,
                      mentees: y.mentees,
                      asks: y.asks,
                      events: y.events,
                    })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {y.eligible && c?.status !== 'revoked' && (
                      <Button
                        size="sm"
                        variant={c ? 'ghost' : 'primary'}
                        loading={issue.isPending}
                        onClick={() => issue.mutate(y.academicYear)}
                      >
                        {c ? t('alumni.certs.refresh') : t('alumni.certs.get')}
                      </Button>
                    )}
                    {c?.status === 'issued' && (
                      <>
                        <Button
                          size="sm"
                          loading={busy === c.id}
                          onClick={() => void download(c.id, c.academicYear)}
                        >
                          <Download className="size-4" aria-hidden /> {t('alumni.certs.download')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(verifyLink(c.code))
                              .then(() => toast.success(t('alumni.certs.copied')))
                              .catch(() => toast.error(t('errors.generic')))
                          }
                        >
                          {t('alumni.certs.copy')}
                        </Button>
                      </>
                    )}
                  </div>
                  {!y.eligible && !c && <p className="text-caption text-fg-3">{t('alumni.certs.nothing')}</p>}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Giving ─────────────────────────────

function PaidDialog({ p, onClose }: { p: PledgeView; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reference, setReference] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/me/pledges/${p.id}/paid`, { reference: reference.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pledges'] });
      onClose();
    },
    onError: fail(t),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('alumni.giving.paidTitle')}
      description={t('alumni.giving.paidBody')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={reference.trim().length < 3}
            onClick={() => save.mutate()}
          >
            {t('alumni.giving.paidSave')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <Field label={t('alumni.giving.reference')}>
        {({ id }) => (
          <Input id={id} maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} />
        )}
      </Field>
    </Dialog>
  );
}

function GivingPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const funds = useQuery(q.funds());
  const mine = useQuery(q.myPledges());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [paid, setPaid] = useState<PledgeView | null>(null);
  const pledge = useMutation({
    mutationFn: (v: { fundId: string; amountPaise: number }) =>
      api.postOnce('/giving/pledges', v, newIdempotencyKey()),
    onSuccess: () => {
      toast.success(t('alumni.giving.pledged'));
      setAmounts({});
      void qc.invalidateQueries({ queryKey: ['pledges'] });
      void qc.invalidateQueries({ queryKey: ['funds'] });
    },
    onError: fail(t),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/me/pledges/${id}/cancel`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pledges'] }),
    onError: fail(t),
  });
  const ack = async (p: PledgeView) => {
    try {
      saveBlob(
        await apiBlob(`/me/pledges/${p.id}/acknowledgement`),
        `${(p.receiptNo ?? 'receipt').replace(/\//g, '-')}.pdf`,
      );
    } catch (e) {
      fail(t)(e);
    }
  };
  return (
    <div className="grid gap-5">
      <p className="max-w-[60ch] text-fg-2">{t('alumni.giving.intro')}</p>
      {funds.isLoading && <Skeleton className="h-40" />}
      {funds.data && !funds.data.length && (
        <EmptyState art={<Illustration kind="empty" />} title={t('alumni.giving.noFunds')} />
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {funds.data?.map((f) => {
          const paise = toPaise(amounts[f.id] ?? '');
          return (
            <li key={f.id}>
              <Card className="grid gap-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{f.title}</span>
                  <Badge>{t(`alumni.purpose.${f.purpose}`)}</Badge>
                </div>
                <p className="text-callout text-fg-2">{f.description}</p>
                {f.targetPaise ? (
                  <ProgressBar
                    value={f.receivedPaise}
                    max={f.targetPaise}
                    label={f.title}
                    valueText={t('alumni.giving.raised', {
                      got: rupees(f.receivedPaise),
                      target: rupees(f.targetPaise),
                    })}
                  />
                ) : null}
                <p className="text-callout">
                  {f.targetPaise
                    ? t('alumni.giving.raised', {
                        got: rupees(f.receivedPaise),
                        target: rupees(f.targetPaise),
                      })
                    : t('alumni.giving.received', { got: rupees(f.receivedPaise) })}
                </p>
                {f.payLink && (
                  <a
                    href={f.payLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonVariants({ size: 'sm' })}
                  >
                    <ExternalLink className="size-4" aria-hidden /> {t('alumni.giving.payCollege')}
                  </a>
                )}
                {f.bankDetails && (
                  <p className="text-caption whitespace-pre-line text-fg-3">{f.bankDetails}</p>
                )}
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (Number.isFinite(paise) && paise >= 100)
                      pledge.mutate({ fundId: f.id, amountPaise: paise });
                  }}
                >
                  <Field label={t('alumni.giving.amount')}>
                    {({ id }) => (
                      <Input
                        id={id}
                        inputMode="decimal"
                        value={amounts[f.id] ?? ''}
                        onChange={(e) => setAmounts({ ...amounts, [f.id]: e.target.value })}
                      />
                    )}
                  </Field>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={pledge.isPending}
                    disabled={!(Number.isFinite(paise) && paise >= 100)}
                  >
                    {t('alumni.giving.pledge')}
                  </Button>
                </form>
              </Card>
            </li>
          );
        })}
      </ul>
      <section aria-labelledby="my-pledges" className="grid gap-3">
        <h2 id="my-pledges" className="text-headline font-semibold">
          {t('alumni.giving.mine')}
        </h2>
        {mine.data && !mine.data.length && (
          <p className="text-callout text-fg-2">{t('alumni.giving.noPledges')}</p>
        )}
        <ul className="grid gap-2">
          {mine.data?.map((p) => (
            <li key={p.id}>
              <Card className="flex flex-wrap items-center gap-3 p-4">
                <span className="min-w-0 flex-1">
                  <b>{rupees(p.amountPaise)}</b> · {p.fund.title}
                  {p.receiptNo && <span className="block text-caption text-fg-3">{p.receiptNo}</span>}
                </span>
                <Badge tone={PLEDGE_TONE[p.status]}>{t(`alumni.pledge.${p.status}`)}</Badge>
                {(p.status === 'pledged' || p.status === 'paid') && (
                  <>
                    <Button size="sm" onClick={() => setPaid(p)}>
                      {t('alumni.giving.markPaid')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => cancel.mutate(p.id)}>
                      {t('alumni.giving.cancel')}
                    </Button>
                  </>
                )}
                {p.acknowledgement && (
                  <Button size="sm" onClick={() => void ack(p)}>
                    <Download className="size-4" aria-hidden /> {t('alumni.giving.ack')}
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      </section>
      {paid && <PaidDialog p={paid} onClose={() => setPaid(null)} />}
    </div>
  );
}

// ── LinkedIn import ─────────────────────────────

function ImportPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<LinkedinPreview | null>(null);
  const [current, setCurrent] = useState(-1);
  const [skills, setSkills] = useState<Set<string>>(new Set());
  const read = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.upload<LinkedinPreview>('/me/linkedin/preview', form);
    },
    onSuccess: (p) => {
      setPreview(p);
      setCurrent(p.positions.findIndex((x) => x.current));
      setSkills(
        new Set(p.skills.filter((s) => !p.existingSkills.some((e) => e.toLowerCase() === s.toLowerCase()))),
      );
    },
    onError: fail(t),
  });
  const apply = useMutation({
    mutationFn: () => {
      const pos = preview?.positions[current];
      return api.post('/me/linkedin/apply', {
        company: pos?.company ?? '',
        jobTitle: pos?.title ?? '',
        skills: [...skills],
      });
    },
    onSuccess: () => {
      toast.success(t('alumni.import.applied'));
      setPreview(null);
      void qc.invalidateQueries({ queryKey: ['my-profile'] });
    },
    onError: fail(t),
  });
  return (
    <div className="grid gap-4">
      <p className="max-w-[60ch] text-fg-2">{t('alumni.import.intro')}</p>
      <div>
        <input
          ref={input}
          type="file"
          accept=".zip,.csv,application/zip,text/csv"
          className="sr-only"
          // The visible button below opens it; the input itself stays out of the tab order.
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) read.mutate(f);
            e.target.value = '';
          }}
        />
        <Button variant="primary" loading={read.isPending} onClick={() => input.current?.click()}>
          <Upload className="size-4" aria-hidden /> {t('alumni.import.choose')}
        </Button>
      </div>
      {preview && (
        <Card className="grid gap-4 p-4">
          {preview.positions.length > 0 && (
            <Field label={t('alumni.import.current')}>
              {({ id }) => (
                <Select id={id} value={String(current)} onChange={(e) => setCurrent(Number(e.target.value))}>
                  <option value="-1">{t('alumni.import.keepRole')}</option>
                  {preview.positions.map((p, i) => (
                    <option key={`${p.company}-${i}`} value={String(i)}>
                      {[p.title, p.company].filter(Boolean).join(' · ')}
                      {p.from ? ` (${p.from}–${p.to ?? t('alumni.import.now')})` : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {preview.skills.length > 0 && (
            <fieldset className="grid gap-1">
              <legend className="mb-1 text-callout font-semibold">{t('alumni.import.skills')}</legend>
              <div className="grid gap-x-4 sm:grid-cols-2">
                {preview.skills.map((s, i) => (
                  <Checkbox
                    key={s}
                    id={`skill-${i}`}
                    checked={skills.has(s)}
                    onChange={(on) => {
                      const next = new Set(skills);
                      if (on) next.add(s);
                      else next.delete(s);
                      setSkills(next);
                    }}
                  >
                    {s}
                  </Checkbox>
                ))}
              </div>
            </fieldset>
          )}
          {preview.education.length > 0 && (
            <div className="grid gap-1">
              <p className="text-callout font-semibold">{t('alumni.import.education')}</p>
              <ul className="text-callout text-fg-2">
                {preview.education.map((e, i) => (
                  <li key={`${e.school}-${i}`}>{[e.degree, e.school].filter(Boolean).join(', ')}</li>
                ))}
              </ul>
              <p className="text-caption text-fg-3">{t('alumni.import.educationNote')}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={apply.isPending} onClick={() => apply.mutate()}>
              {t('alumni.import.apply')}
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── The page ─────────────────────────────

type Tab = 'asks' | 'certificates' | 'giving' | 'import';

/** Alumni (prompt 2, G6): quick asks, certificates, giving, LinkedIn import and the member's batch. */
export function AlumniPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const canHelp = useCan('alumni:help');
  const canPledge = useCan('giving:pledge');
  const canImport = useCan('profile:import');
  const profile = useQuery({
    ...SCREEN,
    queryKey: ['my-profile'],
    queryFn: () => api.get<{ profile: PublicProfile }>('/me/profile'),
  });
  const tabs = [
    { id: 'asks' as const, label: t('alumni.tabs.asks') },
    ...(canHelp ? [{ id: 'certificates' as const, label: t('alumni.tabs.certificates') }] : []),
    ...(canPledge ? [{ id: 'giving' as const, label: t('alumni.tabs.giving') }] : []),
    ...(canImport ? [{ id: 'import' as const, label: t('alumni.tabs.import') }] : []),
  ];
  const wanted = params.get('tab') as Tab | null;
  const tab: Tab = tabs.some((x) => x.id === wanted) ? (wanted as Tab) : 'asks';
  const f = profile.data?.profile.fields;
  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-6">
      <PageHeader icon={<HandHeart />} title={t('nav.alumni')} intro={t('alumni.intro')} />
      {f?.gradYear && f.branch && (
        <Link
          to={`/batch/${f.gradYear}/${f.branch}`}
          className={cn(buttonVariants({ variant: 'outline' }), 'justify-self-start')}
        >
          <Users className="size-4" aria-hidden />{' '}
          {t('alumni.myBatch', { year: f.gradYear, branch: f.branch })}
        </Link>
      )}
      <Tabs
        label={t('nav.alumni')}
        idBase="alumni"
        value={tab}
        tabs={tabs}
        onChange={(id) => {
          const next = new URLSearchParams(params);
          next.set('tab', id);
          next.delete('box');
          setParams(next, { replace: true });
        }}
      />
      <TabPanel idBase="alumni" id={tab}>
        {tab === 'asks' && <AsksPanel />}
        {tab === 'certificates' && <CertificatesPanel />}
        {tab === 'giving' && <GivingPanel />}
        {tab === 'import' && <ImportPanel />}
      </TabPanel>
    </div>
  );
}
