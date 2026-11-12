import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Flag, Link2, MessageCircle, Share2, Users } from 'lucide-react';
import {
  PARENT_LANGUAGES,
  type BatchmatesView,
  type InviteRunResult,
  type ParentDigestView,
  type ParentLanguage,
  type PublicNameStyle,
  type PublicPageOption,
  type PublicPageView,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input, Select } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { OtpInput } from '../../components/ui/otp';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { Switch } from '../../components/ui/switch';
import { api, ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { useCan } from '../../lib/me';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';

const failed = (t: (k: string) => string) => (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'));

const batchLine = (
  t: (k: string, o?: Record<string, unknown>) => string,
  v: { branch: string | null; gradYear: number | null },
) => (v.branch && v.gradYear ? t('share.batch.batchLine', { branch: v.branch, year: v.gradYear }) : null);

// ── Invite your batch ─────────────────────────────

function Batchmates() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const v = useQuery(q.batchmates());
  const invite = useMutation({
    mutationFn: (count: number) => api.post<InviteRunResult>('/me/batchmates/invite', { count }),
    onSuccess: (r) => {
      toast.success(r.sent ? t('share.batch.sent', { n: r.sent }) : t('share.batch.skipped'));
      void qc.invalidateQueries({ queryKey: ['batchmates'] });
    },
    onError: failed(t),
  });
  if (!v.data) return v.isLoading ? <Skeleton className="h-32" /> : null;
  const b: BatchmatesView = v.data;
  const n = Math.min(b.invitable, b.left, 10);
  return (
    <Card variant="raised" className="grid gap-3 p-4 sm:p-6" role="region" aria-labelledby="batch-title">
      <h2 id="batch-title" className="flex items-center gap-2 text-headline font-semibold">
        <Users className="size-5 text-brand-ink" aria-hidden /> {t('share.batch.title')}
      </h2>
      {batchLine(t, b) && <p className="text-caption text-fg-3">{batchLine(t, b)}</p>}
      <p className="text-body font-semibold">
        {b.notHere ? t('share.batch.notHere', { n: b.notHere }) : t('share.batch.notHereNone')}
      </p>
      {!b.enabled ? (
        <p className="text-callout text-fg-2">{t('share.batch.off')}</p>
      ) : (
        b.notHere > 0 && (
          <div className="grid gap-2">
            <p className="text-callout text-fg-2">{t('share.batch.how')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                disabled={n < 1}
                loading={invite.isPending}
                onClick={() => invite.mutate(n)}
              >
                <MessageCircle className="size-4" aria-hidden />{' '}
                {t('share.batch.invite', { n: Math.max(n, 1) })}
              </Button>
              <span className="text-caption text-fg-3">
                {b.left ? t('share.batch.left', { n: b.left }) : t('share.batch.noneLeft')}
              </span>
            </div>
          </div>
        )
      )}
    </Card>
  );
}

// ── Public pages ─────────────────────────────

async function shareUrl(url: string, title: string): Promise<boolean> {
  const data = { title, url };
  if (navigator.share && navigator.canShare?.(data)) {
    await navigator.share(data);
    return true;
  }
  await navigator.clipboard.writeText(url);
  return false;
}

function LivePage({ page }: { page: PublicPageView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const down = useMutation({
    mutationFn: () => api.delete(`/me/public-pages/${page.id}`),
    onSuccess: () => {
      toast.success(t('share.pages.takenDown'));
      void qc.invalidateQueries({ queryKey: ['public-pages'] });
    },
    onError: failed(t),
  });
  const copy = useMutation({
    mutationFn: () => shareUrl(page.url, page.content?.headline ?? ''),
    onSuccess: (native) => !native && toast.success(t('share.pages.copied')),
    onError: (e) => (e as Error).name !== 'AbortError' && toast.error(t('errors.generic')),
  });
  return (
    <div className="flex flex-wrap gap-2">
      <a
        href={page.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center gap-1.5 text-callout font-semibold text-brand-ink underline"
      >
        <ExternalLink className="size-4" aria-hidden /> {t('share.pages.open')}
      </a>
      <Button size="sm" loading={copy.isPending} onClick={() => copy.mutate()}>
        <Link2 className="size-4" aria-hidden /> {t('share.pages.copy')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-danger-ink"
        loading={down.isPending}
        onClick={() => down.mutate()}
      >
        {t('share.pages.takeDown')}
      </Button>
      <span className="self-center text-caption text-fg-3">{t('share.pages.views', { n: page.views })}</span>
    </div>
  );
}

function PublishDialog({ option, onClose }: { option: PublicPageOption; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [nameStyle, setNameStyle] = useState<PublicNameStyle>('full');
  const [indexable, setIndexable] = useState(false);
  const publish = useMutation({
    mutationFn: () =>
      api.post<PublicPageView>('/me/public-pages', {
        kind: option.kind,
        refId: option.refId,
        nameStyle,
        indexable,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['public-pages'] });
      onClose();
    },
    onError: failed(t),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('share.pages.dialogTitle')}
      description={t('share.pages.dialogBody')}
      footer={
        <Button variant="primary" loading={publish.isPending} onClick={() => publish.mutate()}>
          {t('share.pages.publish')}
        </Button>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1 rounded-[var(--radius-md)] bg-surface-2 p-3">
          <span className="text-caption text-fg-3">{t('share.pages.preview')}</span>
          <span className="font-semibold">{option.headline}</span>
        </div>
        <ChoiceGroup
          label={t('share.pages.nameLabel')}
          value={nameStyle}
          onChange={setNameStyle}
          variant="chip"
          options={[
            { value: 'full', label: t('share.pages.nameFull') },
            { value: 'first', label: t('share.pages.nameFirst') },
          ]}
        />
        <Switch
          checked={indexable}
          onChange={setIndexable}
          label={t('share.pages.indexable')}
          description={t('share.pages.indexableBody')}
        />
      </div>
    </Dialog>
  );
}

function PublicPages() {
  const { t } = useTranslation();
  const v = useQuery(q.myPublicPages());
  const [publishing, setPublishing] = useState<PublicPageOption | null>(null);
  if (v.isError) return <ErrorState error={v.error} onRetry={() => void v.refetch()} />;
  if (!v.data) return <Skeleton className="h-40" />;
  const live = new Map(v.data.pages.filter((p) => p.status === 'live').map((p) => [p.id, p]));
  return (
    <section aria-labelledby="pages-title" className="grid gap-3">
      <h2 id="pages-title" className="flex items-center gap-2 text-headline font-semibold">
        <Share2 className="size-5 text-brand-ink" aria-hidden /> {t('share.pages.title')}
      </h2>
      <p className="text-callout text-fg-2">{t('share.pages.intro')}</p>
      {!v.data.allowed && <p className="text-callout text-fg-2">{t('share.pages.minor')}</p>}
      {v.data.allowed && !v.data.options.length && (
        <EmptyState icon={<Share2 className="size-6" />} title={t('share.pages.title')}>
          {t('share.pages.none')}
        </EmptyState>
      )}
      <ul className="grid gap-2">
        {v.data.options.map((o) => {
          const page = o.pageId ? live.get(o.pageId) : undefined;
          return (
            <li key={`${o.kind}-${o.refId ?? ''}`}>
              <Card className="grid gap-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="grid">
                    <span className="text-caption text-fg-3">{t(`share.pages.kind.${o.kind}`)}</span>
                    <span className="font-semibold">{o.headline}</span>
                  </div>
                  {page ? (
                    <Badge tone="success">{t('share.pages.published')}</Badge>
                  ) : (
                    <Button size="sm" variant="primary" onClick={() => setPublishing(o)}>
                      {t('share.pages.publish')}
                    </Button>
                  )}
                </div>
                {page && <LivePage page={page} />}
              </Card>
            </li>
          );
        })}
      </ul>
      {publishing && <PublishDialog option={publishing} onClose={() => setPublishing(null)} />}
    </section>
  );
}

// ── The parent digest ─────────────────────────────

function ParentDigest() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const v = useQuery(q.parentDigest());
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState<ParentLanguage>('en');
  const [code, setCode] = useState('');
  const set = (d: ParentDigestView) => qc.setQueryData(q.parentDigest().queryKey, d);
  const start = useMutation({
    mutationFn: () =>
      api.post<ParentDigestView>('/me/parent-digest', { phone: phone.replace(/[\s-]/g, ''), language }),
    onSuccess: set,
    onError: failed(t),
  });
  const confirm = useMutation({
    mutationFn: (c: string) => api.post<ParentDigestView>('/me/parent-digest/confirm', { code: c }),
    onSuccess: (d) => {
      set(d);
      toast.success(t('share.parent.confirmed'));
    },
    onError: failed(t),
  });
  const grades = useMutation({
    mutationFn: (on: boolean) => api.put<ParentDigestView>('/me/parent-digest/grades', { includeGrades: on }),
    onSuccess: set,
    onError: failed(t),
  });
  const stop = useMutation({
    mutationFn: () => api.delete<ParentDigestView>('/me/parent-digest'),
    onSuccess: () => {
      toast.success(t('share.parent.stopped'));
      void qc.invalidateQueries({ queryKey: ['parent-digest'] });
    },
    onError: failed(t),
  });
  const d = v.data;
  return (
    <Card variant="raised" className="grid gap-3 p-4 sm:p-6" role="region" aria-labelledby="parent-title">
      <h2 id="parent-title" className="text-headline font-semibold">
        {t('share.parent.title')}
      </h2>
      <p className="text-callout text-fg-2">{t('share.parent.intro')}</p>
      {!d && <Skeleton className="h-24" />}
      {d?.status === 'none' && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start.mutate();
          }}
        >
          <Field label={t('share.parent.phone')} hint={t('share.parent.phoneHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            )}
          </Field>
          <Field label={t('share.parent.language')}>
            {({ id }) => (
              <Select
                id={id}
                value={language}
                onChange={(e) => setLanguage(e.target.value as ParentLanguage)}
              >
                {PARENT_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {t(`share.parent.lang.${l}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div>
            <Button type="submit" variant="primary" loading={start.isPending}>
              {t('share.parent.start')}
            </Button>
          </div>
        </form>
      )}
      {d?.status === 'pending' && (
        <div className="grid gap-3">
          <p className="font-semibold">{t('share.parent.codeTitle')}</p>
          <p className="text-callout text-fg-2">
            {t('share.parent.codeBody', { last4: d.phoneLast4 ?? '' })}
          </p>
          <OtpInput
            label={t('share.parent.code')}
            value={code}
            onChange={setCode}
            onComplete={(c) => confirm.mutate(c)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              loading={confirm.isPending}
              disabled={code.length !== 6}
              onClick={() => confirm.mutate(code)}
            >
              {t('share.parent.confirm')}
            </Button>
            <Button variant="ghost" loading={stop.isPending} onClick={() => stop.mutate()}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
      {d?.status === 'active' && (
        <div className="grid gap-3">
          <p className="font-semibold">
            {t('share.parent.active', {
              last4: d.phoneLast4 ?? '',
              lang: t(`share.parent.lang.${d.language}`),
            })}
          </p>
          {d.lastSentAt && (
            <p className="text-caption text-fg-3">
              {t('share.parent.last', { date: formatDay(d.lastSentAt) })}
            </p>
          )}
          <Switch
            checked={d.includeGrades}
            disabled={grades.isPending}
            onChange={(on) => grades.mutate(on)}
            label={t('share.parent.grades')}
            description={t('share.parent.gradesBody')}
          />
          <div>
            <Button
              variant="ghost"
              className="text-danger-ink"
              loading={stop.isPending}
              onClick={() => stop.mutate()}
            >
              {t('share.parent.stop')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** /share: batchmate invites, opt-in public pages and the parent digest (prompt 2, G8). */
export function SharePage() {
  const { t } = useTranslation();
  const canInvite = useCan('invites:batchmates');
  const canPages = useCan('share:pages');
  const canParent = useCan('parents:digest');
  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-6">
      <PageHeader icon={<Share2 />} title={t('nav.share')} intro={t('share.intro')} />
      {canInvite && <Batchmates />}
      {canPages && <PublicPages />}
      {canParent && <ParentDigest />}
    </div>
  );
}

/** /captain: a Campus Captain's own class, in counts, and invites to it (prompt 2, G8). */
export function CaptainPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const v = useQuery({ ...SCREEN, ...q.captainClass() });
  const invite = useMutation({
    mutationFn: (count: number) => api.post<InviteRunResult>('/captain/invites', { count }),
    onSuccess: (r) => {
      toast.success(r.sent ? t('share.batch.sent', { n: r.sent }) : t('share.batch.skipped'));
      void qc.invalidateQueries({ queryKey: ['captain-class'] });
    },
    onError: failed(t),
  });
  const c = v.data;
  const n = c ? Math.min(c.invitable, c.left, 50) : 0;
  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-6">
      <PageHeader icon={<Flag />} title={t('nav.captain')} intro={t('share.captain.intro')} />
      {v.isLoading && <Skeleton className="h-48" />}
      {v.isError && <ErrorState error={v.error} onRetry={() => void v.refetch()} />}
      {c && (
        <>
          {batchLine(t, c) && <p className="text-callout font-semibold">{batchLine(t, c)}</p>}
          <StatGrid>
            <StatCard label={t('share.captain.onList')} value={c.onList} />
            <StatCard label={t('share.captain.invited')} value={c.invited} />
            <StatCard label={t('share.captain.joined')} value={c.joined} />
            <StatCard label={t('share.captain.verified')} value={c.verified} />
            <StatCard label={t('share.captain.active')} value={c.active7d} />
            <StatCard label={t('share.captain.broughtIn')} value={c.broughtIn} tone="brand" />
          </StatGrid>
          <Card variant="raised" className="grid gap-3 p-4">
            {!c.enabled ? (
              <p className="text-callout text-fg-2">{t('share.captain.off')}</p>
            ) : c.invitable < 1 ? (
              <p className="text-callout text-fg-2">{t('share.captain.allIn')}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  disabled={n < 1}
                  loading={invite.isPending}
                  onClick={() => invite.mutate(n)}
                >
                  <MessageCircle className="size-4" aria-hidden />{' '}
                  {t('share.captain.invite', { n: Math.max(n, 1) })}
                </Button>
                <span className="text-caption text-fg-3">
                  {c.left ? t('share.captain.left', { n: c.left }) : t('share.captain.noneLeft')}
                </span>
              </div>
            )}
            <p className="text-caption text-fg-3">{t('share.batch.how')}</p>
          </Card>
        </>
      )}
    </div>
  );
}
