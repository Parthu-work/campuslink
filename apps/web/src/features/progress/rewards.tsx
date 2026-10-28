import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { Gift, Plus } from 'lucide-react';
import {
  REWARD_KINDS,
  XP_TRACKS,
  type MyProgressView,
  type RedemptionView,
  type RewardView,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { Segmented } from '../../components/ui/tab-nav';
import { api, ApiError } from '../../lib/api';
import { formatRelative, newIdempotencyKey } from '../../lib/format';
import { SCREEN } from '../../lib/query-client';

const tone = (s: RedemptionView['status']) =>
  s === 'fulfilled' ? 'success' : s === 'pending' ? 'brand' : 'neutral';

export function RewardsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['progress'], queryFn: () => api.get<MyProgressView>('/me/progress') });
  const rewards = useQuery({
    ...SCREEN,
    queryKey: ['rewards'],
    queryFn: () => api.get<RewardView[]>('/rewards'),
  });
  const mine = useQuery({
    queryKey: ['redemptions'],
    queryFn: () => api.get<RedemptionView[]>('/me/redemptions'),
  });
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['progress'] });
    void qc.invalidateQueries({ queryKey: ['rewards'] });
    void qc.invalidateQueries({ queryKey: ['redemptions'] });
  };
  const redeem = useMutation({
    mutationFn: (rewardId: string) =>
      api.postOnce<RedemptionView>('/rewards/redeem', { rewardId }, newIdempotencyKey()),
    onSuccess: () => {
      toast.success(t('rewards.requested'));
      refresh();
    },
    onError: fail,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/me/redemptions/${id}/cancel`, {}),
    onSuccess: refresh,
    onError: fail,
  });
  const balance = me.data?.balance ?? { xp: 0, impact: 0 };
  return (
    <div className="grid gap-5">
      <PageHeader icon={<Gift />} title={t('rewards.title')} intro={t('rewards.intro')} />
      <p className="text-meta" role="status">
        {t('rewards.balance', { xp: balance.xp, impact: balance.impact })}
      </p>
      {rewards.isLoading ? (
        <Skeleton className="h-40" />
      ) : !rewards.data?.length ? (
        <EmptyState icon={<Gift className="size-6" />} title={t('rewards.empty')} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rewards.data.map((r) => {
            const enough = balance[r.track] >= r.cost;
            const out = r.stock !== null && r.stock <= 0;
            return (
              <li key={r.id}>
                <Card className="grid h-full gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold">{r.title}</h2>
                    <Badge tone="accent">{t(`rewards.kind.${r.kind}`)}</Badge>
                  </div>
                  {r.description && <p className="text-meta text-fg-2">{r.description}</p>}
                  <p className="text-meta">
                    {t('rewards.cost', { cost: r.cost, track: t(`progress.track.${r.track}`) })}
                    {r.stock !== null && (
                      <span className="text-fg-3"> · {t('rewards.stock', { count: r.stock })}</span>
                    )}
                  </p>
                  <Button
                    size="sm"
                    variant="primary"
                    className="justify-self-start"
                    disabled={!enough || out}
                    loading={redeem.isPending && redeem.variables === r.id}
                    onClick={() => redeem.mutate(r.id)}
                  >
                    {out ? t('rewards.outOfStock') : enough ? t('rewards.redeem') : t('rewards.notEnough')}
                  </Button>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <section aria-labelledby="my-requests" className="grid gap-2">
        <h2 id="my-requests" className="font-display text-title font-semibold">
          {t('rewards.mine')}
        </h2>
        {mine.isLoading ? (
          <Skeleton className="h-16" />
        ) : !mine.data?.length ? (
          <p className="text-meta text-fg-2">{t('rewards.noneYet')}</p>
        ) : (
          <ul className="grid gap-2">
            {mine.data.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>
                    <span className="font-semibold">{r.reward.title}</span>
                    <span className="text-meta text-fg-3"> · {formatRelative(r.createdAt)}</span>
                    {r.note && <span className="block text-meta text-fg-2">{r.note}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={tone(r.status)}>{t(`rewards.status.${r.status}`)}</Badge>
                    {r.status === 'pending' && (
                      <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)}>
                        {t('rewards.cancel')}
                      </Button>
                    )}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const blank = {
  title: '',
  description: '',
  kind: 'certificate',
  track: 'xp',
  cost: 100,
  stock: '' as string,
  active: true,
};

export function RewardsAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState(blank);
  const [status, setStatus] = useState<'pending' | 'fulfilled' | 'rejected'>('pending');
  const rewards = useQuery({
    ...SCREEN,
    queryKey: ['admin-rewards'],
    queryFn: () => api.get<RewardView[]>('/admin/rewards'),
  });
  const reds = useQuery({
    queryKey: ['admin-redemptions', status],
    queryFn: () => api.get<RedemptionView[]>(`/admin/redemptions?status=${status}`),
  });
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const create = useMutation({
    mutationFn: () =>
      api.post<RewardView>('/admin/rewards', {
        ...form,
        stock: form.stock === '' ? null : Number(form.stock),
      }),
    onSuccess: () => {
      setForm(blank);
      toast.success(t('rewards.admin.added'));
      void qc.invalidateQueries({ queryKey: ['admin-rewards'] });
    },
    onError: fail,
  });
  const toggle = useMutation({
    mutationFn: (r: RewardView) => api.patch(`/admin/rewards/${r.id}`, { active: !r.active }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-rewards'] }),
    onError: fail,
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: 'fulfil' | 'reject' }) =>
      api.post(`/admin/redemptions/${v.id}/decide`, { decision: v.decision, note: '' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-redemptions'] }),
    onError: fail,
  });
  return (
    <div className="grid gap-6">
      <section aria-labelledby="requests" className="grid gap-2">
        <h2 id="requests" className="font-display text-title font-semibold">
          {t('rewards.admin.requests')}
        </h2>
        <Segmented
          label={t('rewards.admin.filter')}
          value={status}
          onChange={setStatus}
          className="max-w-md"
          options={[
            ['pending', t('rewards.status.pending')],
            ['fulfilled', t('rewards.status.fulfilled')],
            ['rejected', t('rewards.status.rejected')],
          ]}
        />
        {reds.isLoading ? (
          <Skeleton className="h-16" />
        ) : !reds.data?.length ? (
          <p className="text-meta text-fg-2">{t('rewards.admin.noRequests')}</p>
        ) : (
          <ul className="grid gap-2">
            {reds.data.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>
                    <span className="font-semibold">{r.person.name}</span> · {r.reward.title}
                    <span className="block text-caption text-fg-3">
                      {t('rewards.cost', { cost: r.cost, track: t(`progress.track.${r.track}`) })} ·{' '}
                      {formatRelative(r.createdAt)}
                    </span>
                  </span>
                  {r.status === 'pending' ? (
                    <span className="flex gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => decide.mutate({ id: r.id, decision: 'fulfil' })}
                      >
                        {t('rewards.admin.fulfil')}
                      </Button>
                      <Button size="sm" onClick={() => decide.mutate({ id: r.id, decision: 'reject' })}>
                        {t('rewards.admin.reject')}
                      </Button>
                    </span>
                  ) : (
                    <Badge tone={tone(r.status)}>{t(`rewards.status.${r.status}`)}</Badge>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="catalogue" className="grid gap-2">
        <h2 id="catalogue" className="font-display text-title font-semibold">
          {t('rewards.admin.catalogue')}
        </h2>
        <ul className="grid gap-2">
          {(rewards.data ?? []).map((r) => (
            <li key={r.id}>
              <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span>
                  <span className="font-semibold">{r.title}</span>
                  <span className="block text-caption text-fg-3">
                    {t(`rewards.kind.${r.kind}`)} ·{' '}
                    {t('rewards.cost', { cost: r.cost, track: t(`progress.track.${r.track}`) })}
                    {r.stock !== null && ` · ${t('rewards.stock', { count: r.stock })}`}
                  </span>
                </span>
                <Button size="sm" onClick={() => toggle.mutate(r)}>
                  {r.active ? t('rewards.admin.retire') : t('rewards.admin.restore')}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
        <Card className="grid gap-3 p-4">
          <h3 className="font-semibold">{t('rewards.admin.add')}</h3>
          <Field label={t('rewards.admin.name')}>
            {(f) => (
              <Input
                id={f.id}
                aria-describedby={f.describedBy}
                value={form.title}
                maxLength={80}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('rewards.admin.description')}>
            {(f) => (
              <Textarea
                id={f.id}
                aria-describedby={f.describedBy}
                rows={2}
                value={form.description}
                maxLength={500}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label={t('rewards.admin.kind')}>
              {(f) => (
                <Select
                  id={f.id}
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value })}
                >
                  {REWARD_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`rewards.kind.${k}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('rewards.admin.track')}>
              {(f) => (
                <Select
                  id={f.id}
                  value={form.track}
                  onChange={(e) => setForm({ ...form, track: e.target.value })}
                >
                  {XP_TRACKS.map((k) => (
                    <option key={k} value={k}>
                      {t(`progress.track.${k}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('rewards.admin.costLabel')}>
              {(f) => (
                <Input
                  id={f.id}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={1}
                  value={form.cost}
                  onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })}
                />
              )}
            </Field>
            <Field label={t('rewards.admin.stockLabel')} hint={t('rewards.admin.stockHint')}>
              {(f) => (
                <Input
                  id={f.id}
                  aria-describedby={f.describedBy}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={0}
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                />
              )}
            </Field>
          </div>
          <Checkbox
            id="reward-active"
            checked={form.active}
            onChange={(v) => setForm({ ...form, active: v })}
          >
            {t('rewards.admin.active')}
          </Checkbox>
          <Button
            variant="primary"
            className="justify-self-start"
            loading={create.isPending}
            disabled={form.title.trim().length < 3}
            onClick={() => create.mutate()}
          >
            <Plus className="size-4" aria-hidden /> {t('rewards.admin.addButton')}
          </Button>
        </Card>
      </section>
    </div>
  );
}
