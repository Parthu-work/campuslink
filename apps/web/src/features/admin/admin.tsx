import { useDeferredValue, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, UserX, ScrollText } from 'lucide-react';
import {
  contrast,
  ensureContrast,
  onColor,
  TENANT_ROLES,
  FEATURES,
  type Branding,
  type PublicTenant,
  type Role,
  type Feature,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Field, Input, Select } from '../../components/ui/field';
import { Avatar, Badge, Card, Chip, Crest, EmptyState, Skeleton } from '../../components/ui/misc';
import { Dialog } from '../../components/ui/dialog';
import { FormError } from '../../components/layout/auth-layout';
import { api, apiRequest, ApiError } from '../../lib/api';
import { useCan, useMe } from '../../lib/me';
import { applyBranding, useTenant } from '../../lib/tenant-context';
import { cn } from '../../lib/cn';

export function AdminLayout() {
  const { t } = useTranslation();
  const canBrand = useCan('tenant:branding');
  const canAudit = useCan('audit:read');
  const canSettings = useCan('tenant:settings');
  const canImport = useCan('imports:manage');
  const canReview = useCan('verification:review');
  const canOversee = useCan('mentorship:oversee');
  const canUsers = useCan('users:read_admin');
  const canModerate = useCan('moderation:act');
  const canSources = useCan('sources:manage');
  const tabs = [
    ['/admin', t('admin.users'), canUsers],
    ['/admin/imports', t('admin.imports'), canImport],
    ['/admin/list', t('admin.list'), canImport],
    ['/admin/verification', t('admin.verification'), canReview],
    ['/admin/mentorship', t('admin.mentorshipTab'), canOversee],
    ['/admin/moderation', t('admin.moderation'), canModerate],
    ['/admin/sources', t('admin.sources'), canSources],
    ['/admin/branding', t('admin.branding'), canBrand],
    ['/admin/features', t('admin.features'), canSettings],
    ['/admin/audit', t('admin.audit'), canAudit],
  ] as const;
  return (
    <>
      <h1 className="text-[clamp(26px,4vw,34px)] font-bold">{t('nav.admin')}</h1>
      <nav
        aria-label={t('nav.admin')}
        className="flex gap-1 overflow-x-auto rounded-full border border-line bg-surface-1 p-1"
      >
        {tabs
          .filter(([, , ok]) => ok)
          .map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                cn(
                  'min-h-10 flex-none rounded-full px-4 py-2 text-sm font-semibold text-fg-2',
                  isActive && 'bg-brand text-on-brand',
                )
              }
            >
              {label}
            </NavLink>
          ))}
      </nav>
      <Outlet />
    </>
  );
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  capabilities: string[];
  status: 'active' | 'suspended';
  verified: boolean;
  mfaEnabled: boolean;
}

export function UsersAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const canRoles = useCan('roles:assign');
  const canManage = useCan('users:manage');
  const canGrant = useCan('capabilities:grant');
  const canReview = useCan('verification:review');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const dq = useDeferredValue(q);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const params = new URLSearchParams({
    limit: '20',
    ...(dq.trim() ? { q: dq.trim() } : {}),
    ...(role ? { role } : {}),
  });
  const users = useInfiniteQuery({
    queryKey: ['admin-users', dq, role],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiRequest<AdminUser[]>(`/admin/users?${params}${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.meta?.nextCursor ?? undefined,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-users'] });
  const mutate = useMutation({
    mutationFn: ({ id, path, body }: { id: string; path: string; body: unknown }) =>
      api.patch<AdminUser>(`/admin/users/${id}/${path}`, body),
    onSuccess: () => {
      toast.success(t('common.saved'));
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const unverify = useMutation({
    mutationFn: (id: string) => api.post(`/admin/users/${id}/unverify`),
    onSuccess: () => {
      toast.success(t('common.saved'));
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = users.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t('admin.searchUsers')}</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-fg-3"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('admin.searchUsers')}
            className="pl-11"
            type="search"
          />
        </label>
        <label className="w-full sm:w-52">
          <span className="sr-only">{t('admin.roles')}</span>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">{t('admin.allRoles')}</option>
            {TENANT_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}`)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {users.isLoading && <Skeleton className="h-48" />}
      {users.isSuccess && rows.length === 0 && (
        <EmptyState icon={<UserX className="size-6" />} title={t('admin.noUsers')} />
      )}
      <ul className="grid gap-2">
        {rows.map((u) => (
          <li key={u.id}>
            <Card className="flex flex-wrap items-center gap-3 p-3">
              <Avatar name={u.name} verified={u.verified} />
              <div className="min-w-0 flex-1">
                <b className="block truncate text-sm">{u.name}</b>
                <span className="block truncate text-xs text-fg-2">{u.email}</span>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {u.roles.map((r) => (
                    <Badge key={r} tone="brand">
                      {t(`role.${r}`)}
                    </Badge>
                  ))}
                  {u.capabilities.includes('CERTIFIED_CONTRIBUTOR') && (
                    <Badge tone="accent">{t('admin.contributor')}</Badge>
                  )}
                  {!u.verified && <Badge tone="warning">{t('admin.unverified')}</Badge>}
                  {u.status === 'suspended' && <Badge tone="danger">{t('admin.suspended')}</Badge>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {canRoles && (
                  <Button size="sm" onClick={() => setEditing(u)}>
                    {t('admin.editRoles')}
                  </Button>
                )}
                {canGrant && u.roles.includes('STUDENT') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      mutate.mutate({
                        id: u.id,
                        path: 'capabilities',
                        body: { capabilities: u.capabilities.length ? [] : ['CERTIFIED_CONTRIBUTOR'] },
                      })
                    }
                  >
                    {u.capabilities.length ? t('admin.revokeContributor') : t('admin.grantContributor')}
                  </Button>
                )}
                {canReview &&
                  u.verified &&
                  !u.roles.some((r) => ['COLLEGE_ADMIN', 'TPO', 'FACULTY'].includes(r)) && (
                    <Button size="sm" variant="ghost" onClick={() => unverify.mutate(u.id)}>
                      {t('admin.unverify')}
                    </Button>
                  )}
                {canManage && u.id !== me?.id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      mutate.mutate({
                        id: u.id,
                        path: 'status',
                        body: { status: u.status === 'active' ? 'suspended' : 'active' },
                      })
                    }
                  >
                    {u.status === 'active' ? t('admin.suspend') : t('admin.reactivate')}
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {users.hasNextPage && (
        <Button
          className="justify-self-center"
          onClick={() => void users.fetchNextPage()}
          loading={users.isFetchingNextPage}
        >
          {t('common.loadMore')}
        </Button>
      )}
      {editing && <RolesDialog user={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function RolesDialog({
  user,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<Role[]>(user.roles);
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: () => api.patch(`/admin/users/${user.id}/roles`, { roles }),
    onSuccess: () => {
      toast.success(t('admin.rolesSaved'));
      onSaved();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('admin.editRoles')}
      description={`${user.name} · ${user.email}`}
    >
      <FormError message={error} />
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('admin.roles')}>
        {TENANT_ROLES.map((r) => (
          <Chip
            key={r}
            pressed={roles.includes(r)}
            onClick={() => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]))}
          >
            {t(`role.${r}`)}
          </Chip>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={roles.length === 0}
          onClick={() => save.mutate()}
        >
          {t('common.save')}
        </Button>
      </div>
    </Dialog>
  );
}

export function BrandingAdmin() {
  const { t } = useTranslation();
  const tenant = useTenant();
  const qc = useQueryClient();
  const [b, setB] = useState<Branding>(tenant.branding);
  const [error, setError] = useState<string>();
  // Live preview: apply as the admin edits; restore on leave if not saved.
  useEffect(() => {
    applyBranding(b);
  }, [b]);
  useEffect(
    () => () => applyBranding((qc.getQueryData<PublicTenant>(['tenant']) ?? tenant).branding),
    [qc, tenant],
  );
  const save = useMutation({
    mutationFn: () => api.put<PublicTenant>('/tenant/branding', b),
    onSuccess: (t2) => {
      qc.setQueryData(['tenant'], t2);
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => setError(e instanceof ApiError && e.details ? `${e.message}` : e.message),
  });
  const set = (k: keyof Branding) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setB({ ...b, [k]: e.target.value });
  const colours = (['primary', 'secondary', 'accent'] as const).map((k) => {
    const c = b[k];
    return {
      k,
      c,
      onDark: contrast(ensureContrast(c, '#0d1222'), '#0d1222'),
      onLight: contrast(ensureContrast(c, '#ffffff'), '#ffffff'),
      textOn: onColor(c),
    };
  });
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="grid gap-4 p-5">
        <p className="text-sm text-fg-2">{t('admin.brandingIntro')}</p>
        <FormError message={error} />
        <Field label={t('admin.displayName')}>
          {({ id }) => <Input id={id} value={b.displayName} onChange={set('displayName')} maxLength={100} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin.shortName')}>
            {({ id }) => <Input id={id} value={b.shortName} onChange={set('shortName')} maxLength={12} />}
          </Field>
          <Field label={t('admin.monogram')}>
            {({ id }) => <Input id={id} value={b.monogram} onChange={set('monogram')} maxLength={3} />}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {colours.map(({ k, c }) => (
            <Field key={k} label={t(`admin.${k}`)}>
              {({ id }) => (
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={t(`admin.${k}`)}
                    value={c}
                    onChange={set(k)}
                    className="size-12 flex-none cursor-pointer rounded-[var(--radius-sm)] border border-line-strong bg-transparent"
                  />
                  <Input id={id} value={c} onChange={set(k)} className="font-mono" maxLength={7} />
                </div>
              )}
            </Field>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
          <Button variant="ghost" onClick={() => setB(tenant.branding)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Card>
      <Card className="grid content-start gap-4 p-5">
        <span className="eyebrow">{t('admin.preview')}</span>
        <div className="flex items-center gap-3">
          <Crest monogram={b.monogram || '?'} label={b.displayName} size={48} />
          <b className="font-display leading-tight">{b.displayName}</b>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm">
            {t('landing.signIn')}
          </Button>
          <Button variant="accent" size="sm">
            {t('landing.join')}
          </Button>
        </div>
        <ul className="grid gap-1 font-mono text-xs text-fg-2">
          {colours.map(({ k, onDark, onLight }) => (
            <li key={k}>
              {k}: {onDark.toFixed(1)}:1 dark · {onLight.toFixed(1)}:1 light
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

interface Settings {
  features: Record<Feature, boolean>;
  allowedEmailDomains: string[];
}
export function FeaturesAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['tenant-settings'],
    queryFn: () => api.get<Settings>('/tenant/settings'),
  });
  const [domains, setDomains] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (
      body: Partial<{ features: Partial<Record<Feature, boolean>>; allowedEmailDomains: string[] }>,
    ) => api.patch<Settings>('/tenant/settings', body),
    onSuccess: (s) => {
      qc.setQueryData(['tenant-settings'], s);
      void qc.invalidateQueries({ queryKey: ['tenant'] });
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!settings.data) return <Skeleton className="h-64" />;
  const domainText = domains ?? settings.data.allowedEmailDomains.join(', ');
  return (
    <div className="grid gap-5">
      <Card className="grid gap-3 p-5">
        <p className="text-sm text-fg-2">{t('admin.featuresIntro')}</p>
        <ul className="grid gap-2">
          {(Object.keys(FEATURES) as Feature[]).map((f) => (
            <li key={f} className="flex items-center gap-3 rounded-[var(--radius-md)] bg-surface-2 p-3">
              <span className="flex-1 text-sm">{t(`feature.${f}`)}</span>
              <label className="relative inline-flex min-h-11 cursor-pointer items-center">
                <span className="sr-only">{t(`feature.${f}`)}</span>
                <input
                  type="checkbox"
                  role="switch"
                  className="peer sr-only"
                  checked={settings.data.features[f]}
                  onChange={(e) => save.mutate({ features: { [f]: e.target.checked } })}
                />
                <span className="h-7 w-12 rounded-full bg-surface-3 transition-colors peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:top-1/2 after:left-1 after:size-5 after:-translate-y-1/2 after:rounded-full after:bg-white after:transition-transform after:duration-[var(--dur-base)] peer-checked:after:translate-x-5" />
              </label>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-5">
        <form
          className="grid max-w-lg gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({
              allowedEmailDomains: domainText
                .split(',')
                .map((d) => d.trim())
                .filter(Boolean),
            });
          }}
        >
          <Field label={t('admin.allowedDomains')} hint={t('admin.allowedDomainsHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={domainText}
                onChange={(e) => setDomains(e.target.value)}
                className="font-mono"
              />
            )}
          </Field>
          <Button type="submit" variant="primary" className="justify-self-start" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </form>
      </Card>
    </div>
  );
}

interface AuditRow {
  _id: string;
  action: string;
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
  ipPrefix: string | null;
}
export function AuditAdmin() {
  const { t, i18n } = useTranslation();
  const log = useInfiniteQuery({
    queryKey: ['audit'],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiRequest<AuditRow[]>(`/admin/audit?limit=50${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.meta?.nextCursor ?? undefined,
  });
  const rows = log.data?.pages.flatMap((p) => p.data) ?? [];
  if (log.isLoading) return <Skeleton className="h-64" />;
  if (!rows.length)
    return <EmptyState icon={<ScrollText className="size-6" />} title={t('admin.auditEmpty')} />;
  return (
    <Card className="overflow-x-auto" tabIndex={0} role="region" aria-label={t('admin.audit')}>
      <table className="w-full min-w-[620px] text-left text-sm">
        <thead className="border-b border-line text-xs text-fg-3">
          <tr>
            <th className="px-4 py-3 font-medium">When</th>
            <th className="px-4 py-3 font-medium">Action</th>
            <th className="px-4 py-3 font-medium">Target</th>
            <th className="px-4 py-3 font-medium">Network</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r._id} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap tabular">
                {new Date(r.createdAt).toLocaleString(i18n.language)}
              </td>
              <td className="px-4 py-2.5">
                <Badge
                  tone={
                    r.action.includes('reuse') || r.action.includes('locked') || r.action.includes('suspend')
                      ? 'danger'
                      : 'neutral'
                  }
                >
                  {r.action}
                </Badge>
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-fg-2">
                {r.targetType ? `${r.targetType}:${r.targetId?.slice(-6) ?? ''}` : '—'}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-fg-3">{r.ipPrefix ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {log.hasNextPage && (
        <div className="grid p-3">
          <Button
            className="justify-self-center"
            onClick={() => void log.fetchNextPage()}
            loading={log.isFetchingNextPage}
          >
            {t('common.loadMore')}
          </Button>
        </div>
      )}
    </Card>
  );
}
