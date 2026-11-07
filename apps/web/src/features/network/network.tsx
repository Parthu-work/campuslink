import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Building2, Copy, Flag, Globe2, Handshake, Search, ShieldCheck } from 'lucide-react';
import {
  APP_NAME,
  INTRO_DECLINE_REASONS,
  INTRO_GOALS,
  INTRO_SHARE,
  NETWORK_INTRO_NOTE_MAX,
  NETWORK_INTROS_RECEIVED_MAX,
  SEEKING,
  SESSION_TYPES,
  type CredentialSource,
  type IntroGoal,
  type IntroShare,
  type NameStyle,
  type NetworkCard,
  type NetworkSettingsBody,
  type NetworkSettingsView,
  type SessionType,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { Switch } from '../../components/ui/switch';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { api, ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import * as nq from './queries';

type Tab = 'alumni' | 'intros' | 'credentials' | 'employers' | 'settings';
const TABS: readonly Tab[] = ['alumni', 'intros', 'credentials', 'employers', 'settings'];

const useFail = () => {
  const { t } = useTranslation();
  return (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
};

// ── Alumni across colleges ─────────────────────────────

function AskDialog({ card, onClose }: { card: NetworkCard; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fail = useFail();
  const [key] = useState(() => crypto.randomUUID());
  const [helpWith, setHelpWith] = useState<SessionType>(card.helpWith[0] ?? 'quick_chat');
  const [goal, setGoal] = useState<IntroGoal>('career_advice');
  const [note, setNote] = useState('');
  const send = useMutation({
    mutationFn: () => api.postOnce('/network/intros', { ref: card.ref, helpWith, goal, note }, key),
    onSuccess: () => {
      toast.success(t('network.ask.sent', { name: card.name }));
      void qc.invalidateQueries({ queryKey: ['network', 'intros'] });
      onClose();
    },
    onError: fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('network.ask.title', { name: card.name })}
      description={t('network.ask.description')}
      footer={
        <Button variant="primary" loading={send.isPending} onClick={() => send.mutate()}>
          {t('network.ask.send')}
        </Button>
      }
    >
      <div className="grid gap-4">
        <Field label={t('network.ask.helpWith')}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={helpWith}
              onChange={(e) => setHelpWith(e.target.value as SessionType)}
            >
              {card.helpWith.map((h) => (
                <option key={h} value={h}>
                  {t(`session.type.${h}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('network.ask.goal')}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={goal}
              onChange={(e) => setGoal(e.target.value as IntroGoal)}
            >
              {INTRO_GOALS.map((g) => (
                <option key={g} value={g}>
                  {t(`network.goals.${g}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('network.ask.note')} hint={t('network.ask.noteHint', { n: NETWORK_INTRO_NOTE_MAX })}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={note}
              maxLength={NETWORK_INTRO_NOTE_MAX}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function AlumniTab({ me, goSettings }: { me: NetworkSettingsView; goSettings: () => void }) {
  const { t } = useTranslation();
  const [company, setCompany] = useState('');
  const [text, setText] = useState('');
  const [qs, setQs] = useState('');
  const [asking, setAsking] = useState<NetworkCard | null>(null);
  const ready = me.college.alumniDiscovery && me.visible.discovery && !me.paused;
  const list = useQuery({ ...nq.networkSearch(qs), enabled: ready });
  if (!me.college.alumniDiscovery)
    return (
      <EmptyState icon={<Globe2 />} title={t('network.alumni.collegeOff')}>
        {t('network.alumni.collegeOffBody')}
      </EmptyState>
    );
  if (me.paused)
    return (
      <EmptyState icon={<Flag />} title={t('network.paused')}>
        {t('network.pausedBody')}
      </EmptyState>
    );
  if (!me.visible.discovery)
    return (
      <EmptyState
        icon={<Globe2 />}
        title={t('network.alumni.joinTitle')}
        action={
          <Button variant="primary" onClick={goSettings}>
            {t('network.alumni.joinAction')}
          </Button>
        }
      >
        {t('network.alumni.joinBody')}
      </EmptyState>
    );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (company.trim().length >= 2) p.set('company', company.trim());
    if (text.trim().length >= 2) p.set('q', text.trim());
    setQs(p.toString());
  };
  return (
    <div className="grid gap-4">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" role="search">
        <Field label={t('network.alumni.company')}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder={t('network.alumni.companyHint')}
            />
          )}
        </Field>
        <Field label={t('network.alumni.text')}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary">
          <Search className="size-4" aria-hidden /> {t('network.alumni.search')}
        </Button>
      </form>
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.isLoading && <Skeleton className="h-32" />}
      {list.data && list.data.items.length === 0 && (
        <EmptyState icon={<Search />} title={t('network.alumni.none')}>
          {t('network.alumni.noneBody')}
        </EmptyState>
      )}
      <ul className="grid gap-3 sm:grid-cols-2" aria-label={t('network.alumni.results')}>
        {list.data?.items.map((c) => (
          <li key={c.ref}>
            <Card variant="raised" className="grid h-full gap-2 p-4">
              <h3 className="text-body font-semibold">{c.name}</h3>
              <p className="text-meta text-fg-2">
                {[c.roleTitle, c.company].filter(Boolean).join(' · ') || t('network.alumni.noCompany')}
              </p>
              <p className="flex items-center gap-1.5 text-caption text-fg-3">
                <Building2 className="size-3.5" aria-hidden /> {c.college.name}
                {c.gradYear ? ` · ${c.gradYear}` : ''}
                {c.branch ? ` · ${c.branch}` : ''}
              </p>
              {c.skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {c.skills.slice(0, 6).map((s) => (
                    <Badge key={s}>{s}</Badge>
                  ))}
                </div>
              )}
              <div className="mt-auto pt-1">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!c.helpWith.length}
                  onClick={() => setAsking(c)}
                >
                  <Handshake className="size-4" aria-hidden /> {t('network.alumni.ask')}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {list.data?.nextCursor && (
        <Button
          variant="outline"
          onClick={() => {
            const p = new URLSearchParams(qs);
            p.set('cursor', list.data?.nextCursor ?? '0');
            setQs(p.toString());
          }}
        >
          {t('network.alumni.more')}
        </Button>
      )}
      {asking && <AskDialog card={asking} onClose={() => setAsking(null)} />}
    </div>
  );
}

// ── Intros ─────────────────────────────

function AcceptDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fail = useFail();
  const [share, setShare] = useState<IntroShare[]>(['email']);
  const accept = useMutation({
    mutationFn: () => api.post(`/network/intros/${id}/accept`, { share }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['network', 'intros'] });
      onClose();
    },
    onError: fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('network.intros.acceptTitle')}
      description={t('network.intros.acceptBody')}
      footer={
        <Button
          variant="primary"
          disabled={!share.length}
          loading={accept.isPending}
          onClick={() => accept.mutate()}
        >
          {t('network.intros.accept')}
        </Button>
      }
    >
      <div className="grid gap-1">
        {INTRO_SHARE.map((s) => (
          <Checkbox
            key={s}
            id={`share-${s}`}
            checked={share.includes(s)}
            onChange={(on) => setShare(on ? [...share, s] : share.filter((x) => x !== s))}
          >
            {t(`network.intros.share.${s}`)}
          </Checkbox>
        ))}
      </div>
    </Dialog>
  );
}

function IntrosTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fail = useFail();
  const [params, setParams] = useSearchParams();
  const box = params.get('box') === 'sent' ? 'sent' : 'received';
  const [accepting, setAccepting] = useState<string | null>(null);
  const v = useQuery(nq.networkIntros());
  const act = useMutation({
    mutationFn: (a: { id: string; path: 'decline' | 'report'; body?: unknown }) =>
      api.post(`/network/intros/${a.id}/${a.path}`, a.body ?? {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['network', 'intros'] }),
    onError: fail,
  });
  if (v.isError) return <ErrorState error={v.error} onRetry={() => void v.refetch()} />;
  if (!v.data) return <Skeleton className="h-40" />;
  const d = v.data;
  return (
    <div className="grid gap-4">
      <ChoiceGroup
        label={t('network.intros.box')}
        variant="chip"
        value={box}
        options={[
          { value: 'received', label: t('network.intros.received') },
          { value: 'sent', label: t('network.intros.sent') },
        ]}
        onChange={(b) => setParams((p) => (p.set('box', b), p), { replace: true })}
      />
      {box === 'sent' && <p className="text-meta text-fg-2">{t('network.intros.left', { n: d.left })}</p>}
      {(box === 'received' ? d.received : d.sent).length === 0 && (
        <EmptyState icon={<Handshake />} title={t(`network.intros.none.${box}`)} />
      )}
      <ul className="grid gap-3">
        {box === 'received' &&
          d.received.map((r) => (
            <li key={r.id}>
              <Card variant="raised" className="grid gap-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-body font-semibold">{r.from.name}</h3>
                  <Badge tone={r.status === 'pending' ? 'info' : 'neutral'}>
                    {t(`network.status.${r.status}`)}
                  </Badge>
                </div>
                <p className="text-caption text-fg-3">
                  {[r.from.college, r.from.branch, r.from.gradYear].filter(Boolean).join(' · ')}
                </p>
                <p className="text-meta">
                  {t(`session.type.${r.helpWith}`)} · {t(`network.goals.${r.goal}`)}
                </p>
                {r.note && <p className="text-meta whitespace-pre-line text-fg-2">{r.note}</p>}
                {r.status === 'pending' && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" onClick={() => setAccepting(r.id)}>
                      {t('network.intros.accept')}
                    </Button>
                    <Select
                      size="sm"
                      aria-label={t('network.intros.decline')}
                      value=""
                      className="w-auto"
                      onChange={(e) =>
                        e.target.value &&
                        act.mutate({ id: r.id, path: 'decline', body: { reason: e.target.value } })
                      }
                    >
                      <option value="">{t('network.intros.decline')}</option>
                      {INTRO_DECLINE_REASONS.map((x) => (
                        <option key={x} value={x}>
                          {t(`network.declines.${x}`)}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => act.mutate({ id: r.id, path: 'report' })}
                    >
                      <Flag className="size-4" aria-hidden /> {t('network.intros.report')}
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        {box === 'sent' &&
          d.sent.map((s) => (
            <li key={s.id}>
              <Card variant="raised" className="grid gap-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-body font-semibold">{s.to.name}</h3>
                  <Badge tone={s.status === 'accepted' ? 'success' : 'neutral'}>
                    {t(`network.status.${s.status}`)}
                  </Badge>
                </div>
                <p className="text-caption text-fg-3">
                  {[s.to.company, s.to.college].filter(Boolean).join(' · ')}
                </p>
                {s.declineReason && (
                  <p className="text-meta text-fg-2">{t(`network.declines.${s.declineReason}`)}</p>
                )}
                {s.shared && (
                  <div className="grid gap-1 text-meta">
                    <p className="font-semibold">{t('network.intros.sharedWithYou')}</p>
                    {s.shared.email && (
                      <a className="text-brand-ink underline" href={`mailto:${s.shared.email}`}>
                        {s.shared.email}
                      </a>
                    )}
                    {s.shared.linkedin && (
                      <a
                        className="text-brand-ink underline"
                        href={s.shared.linkedin}
                        target="_blank"
                        rel="noreferrer"
                      >
                        LinkedIn
                      </a>
                    )}
                  </div>
                )}
              </Card>
            </li>
          ))}
      </ul>
      {accepting && <AcceptDialog id={accepting} onClose={() => setAccepting(null)} />}
    </div>
  );
}

// ── Credentials ─────────────────────────────

function CredentialsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fail = useFail();
  const [nameStyle, setNameStyle] = useState<NameStyle>('full');
  const v = useQuery(nq.myCredentials());
  const done = () => void qc.invalidateQueries({ queryKey: ['credentials'] });
  const issue = useMutation({
    mutationFn: (s: CredentialSource) =>
      api.postOnce(
        '/credentials',
        s.type === 'ReadinessMilestoneCredential'
          ? { type: s.type, milestone: s.milestone, nameStyle }
          : { type: s.type, sourceId: s.sourceId, nameStyle },
        crypto.randomUUID(),
      ),
    onSuccess: () => {
      toast.success(t('network.credentials.issued'));
      done();
    },
    onError: fail,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/credentials/${id}`),
    onSuccess: done,
    onError: fail,
  });
  if (v.isError) return <ErrorState error={v.error} onRetry={() => void v.refetch()} />;
  if (!v.data) return <Skeleton className="h-40" />;
  const d = v.data;
  if (d.minor) return <EmptyState icon={<ShieldCheck />} title={t('network.minor')} />;
  if (!d.enabled)
    return (
      <EmptyState icon={<BadgeCheck />} title={t('network.credentials.off')}>
        {t('network.credentials.offBody')}
      </EmptyState>
    );
  const open = d.sources.filter((s) => !s.issued);
  return (
    <div className="grid gap-5">
      <p className="text-meta text-fg-2">{t('network.credentials.intro')}</p>
      {d.credentials.length === 0 && (
        <EmptyState icon={<BadgeCheck />} title={t('network.credentials.none')} />
      )}
      <ul className="grid gap-3">
        {d.credentials.map((c) => (
          <li key={c.id}>
            <Card variant="raised" className="grid gap-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-body font-semibold">{t(`network.credentialTypes.${c.type}`)}</h3>
                <Badge tone={c.status === 'active' ? 'success' : 'danger'}>
                  {t(`network.credentials.status.${c.status}`)}
                </Badge>
              </div>
              <p className="text-meta text-fg-2">{Object.values(c.claims).join(' · ')}</p>
              <p className="text-caption text-fg-3">
                {t('network.credentials.issuedOn', { date: formatDay(c.issuedAt) })}
              </p>
              {c.status === 'active' && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void navigator.clipboard
                        ?.writeText(c.url)
                        .then(() => toast.success(t('network.credentials.copied')))
                    }
                  >
                    <Copy className="size-4" aria-hidden /> {t('network.credentials.copy')}
                  </Button>
                  <a
                    className="inline-flex min-h-11 items-center text-meta font-semibold text-brand-ink underline"
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('network.credentials.open')}
                  </a>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={revoke.isPending}
                    onClick={() => revoke.mutate(c.id)}
                  >
                    {t('network.credentials.revoke')}
                  </Button>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
      {open.length > 0 && (
        <Card variant="raised" className="grid gap-3 p-4">
          <h2 className="text-title font-semibold">{t('network.credentials.available')}</h2>
          <ChoiceGroup
            label={t('network.settings.nameStyle')}
            variant="chip"
            value={nameStyle}
            options={[
              { value: 'full', label: t('network.settings.nameFull') },
              { value: 'first', label: t('network.settings.nameFirst') },
            ]}
            onChange={setNameStyle}
          />
          <ul className="grid gap-2">
            {open.map((s) => (
              <li
                key={`${s.type}-${s.sourceId ?? s.milestone}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="text-meta">
                  {t(`network.credentialTypes.${s.type}`)}: {s.label}
                </span>
                <Button size="sm" variant="primary" loading={issue.isPending} onClick={() => issue.mutate(s)}>
                  {t('network.credentials.get')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── Employers (the student's shared applications) ─────────────────────────────

function EmployersTab({ me, goSettings }: { me: NetworkSettingsView; goSettings: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fail = useFail();
  const v = useQuery({ ...nq.myCandidacies(), enabled: me.college.employerAccess });
  const done = () => void qc.invalidateQueries({ queryKey: ['network', 'candidacies'] });
  const share = useMutation({
    mutationFn: (driveId: string) => api.postOnce('/network/candidacies', { driveId }, crypto.randomUUID()),
    onSuccess: done,
    onError: fail,
  });
  const stop = useMutation({
    mutationFn: (ref: string) => api.delete(`/network/candidacies/${ref}`),
    onSuccess: done,
    onError: fail,
  });
  if (!me.college.employerAccess)
    return (
      <EmptyState icon={<Building2 />} title={t('network.employers.collegeOff')}>
        {t('network.employers.collegeOffBody')}
      </EmptyState>
    );
  if (v.isError) return <ErrorState error={v.error} onRetry={() => void v.refetch()} />;
  if (!v.data) return <Skeleton className="h-32" />;
  return (
    <div className="grid gap-4">
      <p className="text-meta text-fg-2">{t('network.employers.intro')}</p>
      {!me.visible.employers && (
        <Card variant="raised" className="grid gap-2 p-4">
          <p className="text-meta">{t('network.employers.consentFirst')}</p>
          <div>
            <Button size="sm" variant="primary" onClick={goSettings}>
              {t('network.alumni.joinAction')}
            </Button>
          </div>
        </Card>
      )}
      {v.data.eligible.length === 0 && v.data.shared.length === 0 && (
        <EmptyState icon={<Building2 />} title={t('network.employers.none')}>
          {t('network.employers.noneBody')}
        </EmptyState>
      )}
      <ul className="grid gap-3">
        {v.data.eligible.map((c) => (
          <li key={c.driveId}>
            <Card variant="raised" className="flex flex-wrap items-center justify-between gap-2 p-4">
              <span className="text-meta">
                <b>{c.employer}</b> · {c.title}
              </span>
              <Button
                size="sm"
                variant="primary"
                disabled={!me.visible.employers}
                loading={share.isPending}
                onClick={() => share.mutate(c.driveId)}
              >
                {t('network.employers.share', { name: c.employer })}
              </Button>
            </Card>
          </li>
        ))}
        {v.data.shared.map((c) => (
          <li key={c.ref}>
            <Card variant="raised" className="flex flex-wrap items-center justify-between gap-2 p-4">
              <span className="grid gap-1 text-meta">
                <span>
                  <b>{c.employer}</b> · {c.title}
                </span>
                <Badge tone={c.stage === 'withdrawn' ? 'neutral' : 'info'}>
                  {t(`network.stages.${c.stage}`)}
                </Badge>
              </span>
              {c.stage !== 'withdrawn' && (
                <Button size="sm" variant="ghost" loading={stop.isPending} onClick={() => stop.mutate(c.ref)}>
                  {t('network.employers.stop')}
                </Button>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Settings ─────────────────────────────

function SettingsTab({ me }: { me: NetworkSettingsView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fail = useFail();
  const [s, setS] = useState<NetworkSettingsBody>(me.settings);
  const set = <K extends keyof NetworkSettingsBody>(k: K, v: NetworkSettingsBody[K]) =>
    setS((x) => ({ ...x, [k]: v }));
  const saved = (v: NetworkSettingsView) => {
    qc.setQueryData(nq.networkMe().queryKey, v);
    toast.success(t('network.settings.saved'));
  };
  const save = useMutation({
    mutationFn: () => api.put<NetworkSettingsView>('/network/me', s),
    onSuccess: saved,
    onError: fail,
  });
  const consent = useMutation({
    mutationFn: (b: { purpose: 'network_discovery' | 'employer_visibility'; granted: boolean }) =>
      api.put<NetworkSettingsView>('/network/consents', b),
    onSuccess: saved,
    onError: fail,
  });
  return (
    <div className="grid gap-5">
      <Card variant="raised" className="grid gap-3 p-4 sm:p-6">
        <h2 className="text-title font-semibold">{t('network.settings.consentTitle')}</h2>
        <Switch
          checked={me.consents.network_discovery}
          disabled={consent.isPending || !me.college.alumniDiscovery}
          onChange={(granted) => consent.mutate({ purpose: 'network_discovery', granted })}
          label={t('network.settings.discovery')}
          description={
            me.college.alumniDiscovery ? t('network.settings.discoveryBody') : t('network.alumni.collegeOff')
          }
        />
        <Switch
          checked={me.consents.employer_visibility}
          disabled={consent.isPending || !me.college.employerAccess}
          onChange={(granted) => consent.mutate({ purpose: 'employer_visibility', granted })}
          label={t('network.settings.employers')}
          description={
            me.college.employerAccess
              ? t('network.settings.employersBody')
              : t('network.employers.collegeOff')
          }
        />
        <p className="text-caption text-fg-3">{t('network.settings.revocable')}</p>
      </Card>
      <Card variant="raised" className="grid gap-4 p-4 sm:p-6">
        <h2 className="text-title font-semibold">{t('network.settings.showTitle')}</h2>
        <ChoiceGroup
          label={t('network.settings.nameStyle')}
          variant="chip"
          value={s.nameStyle}
          options={[
            { value: 'full', label: t('network.settings.nameFull') },
            { value: 'first', label: t('network.settings.nameFirst') },
          ]}
          onChange={(v) => set('nameStyle', v)}
        />
        <Switch
          checked={s.showCompany}
          onChange={(v) => set('showCompany', v)}
          label={t('network.settings.showCompany')}
        />
        <Switch
          checked={s.showCity}
          onChange={(v) => set('showCity', v)}
          label={t('network.settings.showCity')}
        />
        <Switch
          checked={s.showSkills}
          onChange={(v) => set('showSkills', v)}
          label={t('network.settings.showSkills')}
        />
        <Field label={t('network.settings.linkedin')} hint={t('network.settings.linkedinHint')}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              type="url"
              inputMode="url"
              value={s.linkedinUrl ?? ''}
              onChange={(e) => set('linkedinUrl', e.target.value.trim() || null)}
            />
          )}
        </Field>
        <Field label={t('network.settings.seeking')}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={s.seeking ?? ''}
              onChange={(e) => set('seeking', (e.target.value || null) as NetworkSettingsBody['seeking'])}
            >
              <option value="">{t('network.settings.seekingNone')}</option>
              {SEEKING.map((x) => (
                <option key={x} value={x}>
                  {t(`network.seeking.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <fieldset className="grid gap-1">
          <legend className="text-meta font-semibold">{t('network.settings.helpWith')}</legend>
          {SESSION_TYPES.map((h) => (
            <Checkbox
              key={h}
              id={`help-${h}`}
              checked={s.helpWith.includes(h)}
              onChange={(on) => set('helpWith', on ? [...s.helpWith, h] : s.helpWith.filter((x) => x !== h))}
            >
              {t(`session.type.${h}`)}
            </Checkbox>
          ))}
        </fieldset>
        <Switch
          checked={s.acceptingIntros}
          onChange={(v) => set('acceptingIntros', v)}
          label={t('network.settings.accepting')}
        />
        <Field label={t('network.settings.perWeek')}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={String(s.introsPerWeek)}
              onChange={(e) => set('introsPerWeek', Number(e.target.value))}
            >
              {Array.from({ length: NETWORK_INTROS_RECEIVED_MAX }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {t('network.settings.save')}
          </Button>
        </div>
      </Card>
      <Card variant="raised" className="grid gap-2 p-4 sm:p-6">
        <h2 className="text-title font-semibold">{t('network.settings.viewedTitle')}</h2>
        {me.viewedBy.length === 0 ? (
          <p className="text-meta text-fg-2">{t('network.settings.viewedNone')}</p>
        ) : (
          <ul className="grid gap-1 text-meta">
            {me.viewedBy.map((v, i) => (
              <li key={`${v.at}-${i}`}>
                {t(`network.settings.viewed.${v.what}`, { employer: v.employer, date: formatDay(v.at) })}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** `/network` (prompt 2, G12, ADR 0014): alumni of other colleges, intros, credentials and what I share. */
export function NetworkPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'alumni';
  const go = (next: Tab) => setParams((p) => (p.set('tab', next), p.delete('box'), p), { replace: true });
  const me = useQuery({ ...SCREEN, ...nq.networkMe() });
  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  return (
    <div className="grid gap-5">
      <PageHeader
        title={t('network.title')}
        icon={<Globe2 />}
        intro={t('network.intro', { app: APP_NAME })}
      />
      {!me.data && <Skeleton className="h-48" />}
      {me.data?.minor && <EmptyState icon={<ShieldCheck />} title={t('network.minor')} />}
      {me.data && !me.data.minor && (
        <>
          <Tabs
            label={t('network.title')}
            idBase="network"
            value={tab}
            tabs={TABS.map((id) => ({ id, label: t(`network.tabs.${id}`) }))}
            onChange={go}
          />
          <TabPanel idBase="network" id={tab}>
            {tab === 'alumni' && <AlumniTab me={me.data} goSettings={() => go('settings')} />}
            {tab === 'intros' && <IntrosTab />}
            {tab === 'credentials' && <CredentialsTab />}
            {tab === 'employers' && <EmployersTab me={me.data} goSettings={() => go('settings')} />}
            {tab === 'settings' && <SettingsTab key={JSON.stringify(me.data.settings)} me={me.data} />}
          </TabPanel>
        </>
      )}
    </div>
  );
}
