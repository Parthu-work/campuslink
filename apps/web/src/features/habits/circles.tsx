import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UsersRound } from 'lucide-react';
import { BRANCHES, CIRCLE_KINDS, type Branch, type CircleKind, type CircleView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input, Select, Textarea } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { api, ApiError } from '../../lib/api';
import { useCan } from '../../lib/me';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';

type Scope = 'mine' | 'discover' | 'pending';

export function CircleCard({ c }: { c: CircleView }) {
  const { t } = useTranslation();
  return (
    <li>
      <Card variant="interactive" className="relative grid gap-1 p-4">
        <Link to={`/circles/${c.id}`} className="font-semibold after:absolute after:inset-0">
          {c.name}
        </Link>
        <p className="flex flex-wrap items-center gap-2 text-meta text-fg-2">
          <Badge>{t(`habits.circles.kind.${c.kind}`)}</Badge>
          {c.status !== 'active' && <Badge tone="warning">{t(`habits.circles.status.${c.status}`)}</Badge>}
          <span>{t('habits.circles.members', { count: c.members })}</span>
        </p>
        {c.description && <p className="line-clamp-2 text-meta text-fg-2">{c.description}</p>}
      </Card>
    </li>
  );
}

function CreateCircle({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const staff = useCan('circles:manage');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CircleKind>('interest');
  const [description, setDescription] = useState('');
  const [branch, setBranch] = useState<Branch | ''>('');
  const [gradYear, setGradYear] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.post<CircleView>('/circles', {
        name: name.trim(),
        kind,
        description: description.trim(),
        branch: kind === 'branch' || kind === 'batch' ? branch || null : null,
        gradYear: kind === 'batch' && gradYear ? Number(gradYear) : null,
      }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['circles'] });
      toast.success(c.status === 'active' ? t('habits.circles.created') : t('habits.circles.proposed'));
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const ready =
    name.trim().length >= 3 &&
    (kind !== 'batch' || /^\d{4}$/.test(gradYear)) &&
    (kind !== 'branch' || !!branch);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={staff ? t('habits.circles.createTitle') : t('habits.circles.proposeTitle')}
      description={staff ? t('habits.circles.createBody') : t('habits.circles.proposeBody')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!ready}
            onClick={() => create.mutate()}
          >
            {staff ? t('habits.circles.create') : t('habits.circles.propose')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <Field label={t('habits.circles.name')}>
          {({ id }) => (
            <Input id={id} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field label={t('habits.circles.kindLabel')}>
          {({ id }) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as CircleKind)}>
              {CIRCLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`habits.circles.kind.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {(kind === 'branch' || kind === 'batch') && (
          <Field label={t('habits.circles.branch')}>
            {({ id }) => (
              <Select id={id} value={branch} onChange={(e) => setBranch(e.target.value as Branch | '')}>
                <option value="">{t('habits.circles.anyBranch')}</option>
                {BRANCHES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {kind === 'batch' && (
          <Field label={t('habits.circles.gradYear')}>
            {({ id }) => (
              <Input
                id={id}
                inputMode="numeric"
                maxLength={4}
                value={gradYear}
                onChange={(e) => setGradYear(e.target.value)}
              />
            )}
          </Field>
        )}
        <Field label={t('habits.circles.description')}>
          {({ id }) => (
            <Textarea
              id={id}
              rows={3}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/** Circles: the member's communities and the ones they can join (prompt 2, G7). */
export function CirclesPage() {
  const { t } = useTranslation();
  const canPropose = useCan('circles:propose');
  const [params, setParams] = useSearchParams();
  const scope = (['mine', 'discover', 'pending'] as const).find((s) => s === params.get('tab')) ?? 'mine';
  const [creating, setCreating] = useState(false);
  const list = useQuery({ ...SCREEN, ...q.circles(scope) });
  return (
    <div className="mx-auto grid w-full max-w-[860px] gap-5">
      <PageHeader
        icon={<UsersRound />}
        title={t('nav.circles')}
        intro={t('habits.circles.intro')}
        actions={
          canPropose ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> {t('habits.circles.new')}
            </Button>
          ) : undefined
        }
      />
      <Tabs<Scope>
        label={t('habits.circles.tabs')}
        idBase="circles"
        value={scope}
        onChange={(s) => setParams(s === 'mine' ? {} : { tab: s }, { replace: true })}
        tabs={(['mine', 'discover', 'pending'] as const).map((s) => ({
          id: s,
          label: t(`habits.circles.tab.${s}`),
        }))}
      />
      <TabPanel idBase="circles" id={scope}>
        {list.isLoading && <Skeleton className="h-40" />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.isSuccess && !list.data.length && (
          <EmptyState icon={<UsersRound className="size-6" />} title={t(`habits.circles.none.${scope}`)} />
        )}
        {!!list.data?.length && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {list.data.map((c) => (
              <CircleCard key={c.id} c={c} />
            ))}
          </ul>
        )}
      </TabPanel>
      {creating && <CreateCircle onClose={() => setCreating(false)} />}
    </div>
  );
}
