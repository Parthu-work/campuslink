import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '../../lib/toast';
import { Building2, Plus, Power } from 'lucide-react';
import { createTenantBody, onColor, type Branding } from '@campuslink/shared';
import type { z } from 'zod';
import { Button } from '../../components/ui/button';
import { Field, Input, Select } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { Dialog } from '../../components/ui/dialog';
import { FormError } from '../../components/layout/auth-layout';
import { api } from '../../lib/api';
import { applyApiError } from '../../lib/errors';
import { SCREEN } from '../../lib/query-client';

interface TenantRow {
  id: string;
  slug: string;
  status: 'active' | 'suspended';
  branding: Branding;
  subscription: { plan: string; seatLimit: number; renewalDate: string | null };
  users: number;
  active30d: number;
}

export function PlatformTenants() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<TenantRow | null>(null);
  const tenants = useQuery({
    ...SCREEN,
    queryKey: ['platform-tenants'],
    queryFn: () => api.get<TenantRow[]>('/platform/tenants'),
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'suspended' }) =>
      api.patch(`/platform/tenants/${id}`, { status }),
    onSuccess: () => {
      setConfirm(null);
      toast.success(t('common.saved'));
      void qc.invalidateQueries({ queryKey: ['platform-tenants'] });
    },
  });
  return (
    <>
      <PageHeader
        title={t('platform.title')}
        actions={
          <>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> {t('platform.create')}
            </Button>
          </>
        }
      />
      <p className="text-meta text-fg-3">{t('platform.privacyNote')}</p>
      {tenants.isLoading && <Skeleton className="h-40" />}
      {tenants.data?.length === 0 && (
        <EmptyState icon={<Building2 className="size-6" />} title={t('platform.create')} />
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {tenants.data?.map((tn) => (
          <li key={tn.id}>
            <Card className="grid gap-3 p-4">
              <div className="flex items-center gap-3">
                <span
                  className="grid size-11 flex-none place-items-center rounded-[var(--radius-md)] font-display font-bold"
                  style={{
                    // The college's own colours (data), with readable text picked for them.
                    background: `linear-gradient(135deg, ${tn.branding.primary}, ${tn.branding.secondary})`,
                    color: onColor(tn.branding.primary),
                  }}
                  aria-hidden
                >
                  {tn.branding.monogram}
                </span>
                <div className="min-w-0 flex-1">
                  <b className="block truncate">{tn.branding.displayName}</b>
                  <span className="font-mono text-caption text-fg-2">{tn.slug}</span>
                </div>
                <Badge tone={tn.status === 'active' ? 'success' : 'danger'}>
                  {t(`platform.status.${tn.status}`)}
                </Badge>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-meta">
                <div>
                  <dt className="eyebrow">{t('platform.plan')}</dt>
                  <dd className="font-mono">
                    {tn.subscription.plan} · {tn.subscription.seatLimit}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">{t('admin.users')}</dt>
                  <dd className="font-mono tabular">
                    {tn.users} · {t('platform.active30d', { count: tn.active30d })}
                  </dd>
                </div>
              </dl>
              {/* A clearly separate, clearly destructive action (it asks first), not a text link. */}
              <div className="flex justify-end border-t border-line pt-3">
                <Button
                  size="sm"
                  variant={tn.status === 'active' ? 'outline' : 'primary'}
                  className={tn.status === 'active' ? 'text-danger-ink' : undefined}
                  onClick={() =>
                    tn.status === 'active' ? setConfirm(tn) : update.mutate({ id: tn.id, status: 'active' })
                  }
                >
                  <Power className="size-4" aria-hidden />
                  {tn.status === 'active' ? t('platform.suspend') : t('platform.resume')}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {confirm && (
        <Dialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={t('platform.suspend')}
          description={t('platform.suspendConfirm', { name: confirm.branding.displayName })}
        >
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={update.isPending}
              onClick={() => update.mutate({ id: confirm.id, status: 'suspended' })}
            >
              {t('platform.suspend')}
            </Button>
          </div>
        </Dialog>
      )}
      {creating && <CreateTenantDialog onClose={() => setCreating(false)} />}
    </>
  );
}

type CreateForm = z.input<typeof createTenantBody>;
function CreateTenantDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const form = useForm<CreateForm>({
    mode: 'onTouched',
    resolver: zodResolver(createTenantBody),
    defaultValues: {
      slug: '',
      branding: {
        displayName: '',
        shortName: '',
        primary: '#3fb8e6',
        secondary: '#6d5ae6',
        accent: '#f2b705',
        monogram: '',
      },
      subscription: { plan: 'trial', seatLimit: 1000, renewalDate: null },
      firstAdmin: { name: '', email: '' },
    },
  });
  const e = form.formState.errors;
  const slug = useWatch({ control: form.control, name: 'slug' });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.post('/platform/tenants', v);
      toast.success(t('platform.created'));
      void qc.invalidateQueries({ queryKey: ['platform-tenants'] });
      onClose();
    } catch (err) {
      applyApiError(err, form.setError, t('errors.generic'));
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('platform.create')}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormError message={e.root?.message} />
        <Field label={t('admin.displayName')} error={e.branding?.displayName?.message}>
          {({ id, invalid }) => (
            <Input id={id} aria-invalid={invalid} {...form.register('branding.displayName')} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label={t('platform.slug')}
            hint={t('platform.slugHint', { slug: slug || 'name' })}
            error={e.slug?.message}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                className="font-mono"
                {...form.register('slug')}
              />
            )}
          </Field>
          <Field label={t('admin.shortName')} error={e.branding?.shortName?.message}>
            {({ id, invalid }) => (
              <Input id={id} aria-invalid={invalid} {...form.register('branding.shortName')} />
            )}
          </Field>
          <Field label={t('admin.monogram')} error={e.branding?.monogram?.message}>
            {({ id, invalid }) => (
              <Input id={id} aria-invalid={invalid} maxLength={3} {...form.register('branding.monogram')} />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('platform.plan')}>
            {({ id }) => (
              <Select id={id} {...form.register('subscription.plan')}>
                <option value="trial">trial</option>
                <option value="standard">standard</option>
                <option value="premium">premium</option>
              </Select>
            )}
          </Field>
          <Field label={t('platform.seats')} error={e.subscription?.seatLimit?.message}>
            {({ id }) => (
              <Input
                id={id}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                {...form.register('subscription.seatLimit', { valueAsNumber: true })}
              />
            )}
          </Field>
        </div>
        <fieldset className="grid gap-3 rounded-[var(--radius-md)] border border-line p-4">
          <legend className="px-1 text-meta font-semibold">{t('platform.firstAdmin')}</legend>
          <Field label={t('platform.adminName')} error={e.firstAdmin?.name?.message}>
            {({ id, invalid }) => (
              <Input id={id} aria-invalid={invalid} {...form.register('firstAdmin.name')} />
            )}
          </Field>
          <Field label={t('platform.adminEmail')} error={e.firstAdmin?.email?.message}>
            {({ id, invalid }) => (
              <Input id={id} type="email" aria-invalid={invalid} {...form.register('firstAdmin.email')} />
            )}
          </Field>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            {t('platform.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface Health {
  dependencies: Record<string, boolean>;
  tenants: number;
  suspended: number;
  users: number;
  activeSessions: number;
  uptimeSec: number;
  memoryMb: number;
}
export function PlatformHealth() {
  const { t } = useTranslation();
  const h = useQuery({
    ...SCREEN,
    queryKey: ['platform-health'],
    queryFn: () => api.get<Health>('/platform/health'),
    refetchInterval: 30_000,
  });
  return (
    <>
      <PageHeader title={t('platform.healthTitle')} />
      {!h.data ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-5">
          <section aria-label={t('platform.health.services')} className="grid gap-3 sm:grid-cols-3">
            {Object.entries(h.data.dependencies).map(([k, ok]) => (
              <Card key={k} className="flex items-center gap-3 p-4">
                <span className={`size-3 rounded-full ${ok ? 'bg-success' : 'bg-danger'}`} aria-hidden />
                <b className="font-mono text-meta">{k}</b>
                <Badge tone={ok ? 'success' : 'danger'} className="ml-auto">
                  {ok ? t('platform.health.up') : t('platform.health.down')}
                </Badge>
              </Card>
            ))}
          </section>
          <StatGrid className="sm:grid-cols-3 md:grid-cols-3">
            {(
              [
                ['colleges', h.data.tenants],
                ['suspended', h.data.suspended],
                ['people', h.data.users],
                ['activeSessions', h.data.activeSessions],
                ['uptime', Math.round(h.data.uptimeSec / 60)],
                ['memory', h.data.memoryMb],
              ] as const
            ).map(([key, v]) => (
              <StatCard key={key} label={t(`platform.health.${key}`)} value={v} />
            ))}
          </StatGrid>
        </div>
      )}
    </>
  );
}
