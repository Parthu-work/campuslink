import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { ImageUp, LayoutDashboard, Search, ScrollText, Trash2 } from 'lucide-react';
import {
  contrast,
  ensureContrast,
  onColor,
  TENANT_ROLES,
  FEATURES,
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  type Branding,
  type PublicTenant,
  type Role,
  type Feature,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Field, Input, Select } from '../../components/ui/field';
import { Avatar, Badge, Card, Chip, Crest, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { Switch } from '../../components/ui/switch';
import { Dialog } from '../../components/ui/dialog';
import { FormError } from '../../components/layout/auth-layout';
import { api, apiRequest, ApiError } from '../../lib/api';
import { useCan, useMe } from '../../lib/me';
import { applyBranding, useTenant } from '../../lib/tenant-context';
import { useNav, type AdminNavGroup } from '../../lib/nav';
import { intentPreload } from '../../lib/preload';
import { ADMIN_ICONS } from '../../lib/admin-icons';
import { BackLink } from '../../components/ui/back-link';
import { cn } from '../../lib/cn';

/** One admin section in the side menu: a 44px row with its icon, the current one marked. */
function AdminMenu({ groups }: { groups: AdminNavGroup[] }) {
  const { t } = useTranslation();
  const row =
    'relative flex min-h-11 items-center gap-3 rounded-[var(--radius-sm)] px-3 text-meta font-semibold text-fg-2 hover:bg-surface-2 hover:text-fg aria-[current=page]:bg-brand-surface aria-[current=page]:text-brand-ink';
  return (
    <div className="grid gap-4">
      <NavLink to="/admin" end className={row} {...intentPreload('/admin')}>
        <LayoutDashboard className="size-5" aria-hidden /> {t('admin.overview')}
      </NavLink>
      {groups.map((g) => (
        <div key={g.group} className="grid gap-1">
          <p className="eyebrow px-3 text-fg-3">{g.label}</p>
          <ul className="grid gap-0.5">
            {g.items.map((i) => {
              const Icon = ADMIN_ICONS[i.id];
              return (
                <li key={i.id}>
                  <NavLink to={i.to} className={row} {...intentPreload(i.to)}>
                    <Icon className="size-5" aria-hidden /> {i.label}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * The admin area (audit §7: thirteen tabs in one scrolling row, no overview): a grouped side menu on
 * desktop; on phones the overview lists the sections and each section has a way back. Sections come
 * from `buildNav()` through `useNav()`, so each member sees only what they may open.
 */
export function AdminLayout() {
  const { t } = useTranslation();
  const { admin } = useNav();
  const { pathname } = useLocation();
  const atHome = pathname.replace(/\/+$/, '') === '/admin';
  const current = admin
    .flatMap((g) => g.items)
    .find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`));
  return (
    <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <nav aria-label={t('admin.sectionsNav')} className="hidden lg:sticky lg:top-5 lg:block">
        <AdminMenu groups={admin} />
      </nav>
      {/* One shrinkable column: a wide table scrolls inside its section instead of widening the page. */}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
        {!atHome && (
          <BackLink to="/admin" className="lg:hidden">
            {t('admin.overview')}
          </BackLink>
        )}
        <PageHeader
          eyebrow={atHome ? undefined : t('nav.admin')}
          title={atHome ? t('nav.admin') : (current?.label ?? t('nav.admin'))}
        />
        <Outlet />
      </div>
    </div>
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
  const [confirming, setConfirming] = useState<{ kind: 'suspend' | 'unverify'; user: AdminUser } | null>(
    null,
  );
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
            enterKeyHint="search"
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
      {users.isError && <ErrorState error={users.error} onRetry={() => void users.refetch()} />}
      {users.isSuccess && rows.length === 0 && (
        <EmptyState art={<Illustration kind="people" />} title={t('admin.noUsers')} />
      )}
      <ul className="grid gap-2">
        {rows.map((u) => (
          <li key={u.id}>
            <Card className="flex flex-wrap items-center gap-3 p-3">
              <Avatar name={u.name} verified={u.verified} />
              <div className="min-w-0 flex-1">
                <b className="block truncate text-meta">{u.name}</b>
                <span className="block truncate text-caption text-fg-2">{u.email}</span>
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
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger-ink"
                      onClick={() => setConfirming({ kind: 'unverify', user: u })}
                    >
                      {t('admin.unverify')}
                    </Button>
                  )}
                {canManage && u.id !== me?.id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn(u.status === 'active' && 'text-danger-ink')}
                    onClick={() =>
                      u.status === 'active'
                        ? setConfirming({ kind: 'suspend', user: u })
                        : mutate.mutate({ id: u.id, path: 'status', body: { status: 'active' } })
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
      {/* Taking something away from a member is confirmed, with what it does (audit DS-7). */}
      <Dialog
        open={!!confirming}
        onOpenChange={(o) => !o && setConfirming(null)}
        title={
          confirming
            ? t(confirming.kind === 'suspend' ? 'admin.suspendTitle' : 'admin.unverifyTitle', {
                name: confirming.user.name,
              })
            : ''
        }
        description={
          confirming ? t(confirming.kind === 'suspend' ? 'admin.suspendBody' : 'admin.unverifyBody') : ''
        }
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={mutate.isPending || unverify.isPending}
            onClick={() => {
              if (!confirming) return;
              const { kind, user } = confirming;
              if (kind === 'suspend')
                mutate.mutate({ id: user.id, path: 'status', body: { status: 'suspended' } });
              else unverify.mutate(user.id);
              setConfirming(null);
            }}
          >
            {confirming?.kind === 'suspend' ? t('admin.suspend') : t('admin.unverify')}
          </Button>
        </div>
      </Dialog>
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

/** The college logo: upload (PNG or WebP, checked here first, then by the server), replace or remove. */
function LogoField({ monogram, name }: { monogram: string; name: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { logoUrl } = useTenant();
  const input = useRef<HTMLInputElement>(null);
  const done = (msg: string) => (t2: PublicTenant) => {
    qc.setQueryData(['tenant'], t2);
    toast.success(msg);
  };
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.set('file', file);
      return api.upload<PublicTenant>('/tenant/logo', fd);
    },
    onSuccess: done(t('admin.logo.saved')),
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api.delete<PublicTenant>('/tenant/logo'),
    onSuccess: done(t('admin.logo.removed')),
    onError: (e: Error) => toast.error(e.message),
  });
  const pick = (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return void toast.error(t('admin.logo.type'));
    if (file.size > LOGO_MAX_BYTES)
      return void toast.error(t('admin.logo.tooBig', { kb: LOGO_MAX_BYTES / 1024 }));
    upload.mutate(file);
  };
  return (
    <div className="grid gap-2">
      <span className="text-meta font-semibold">{t('admin.logo.label')}</span>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-16 flex-none place-items-center rounded-[var(--radius-md)] border border-line bg-surface-2">
          <Crest monogram={monogram || '?'} logoUrl={logoUrl} size={48} label={name} />
        </span>
        <input
          ref={input}
          aria-label={t('admin.logo.upload')}
          type="file"
          accept={LOGO_TYPES.join(',')}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <Button onClick={() => input.current?.click()} loading={upload.isPending}>
          <ImageUp className="size-4" aria-hidden />{' '}
          {logoUrl ? t('admin.logo.replace') : t('admin.logo.upload')}
        </Button>
        {logoUrl && (
          <Button
            variant="ghost"
            className="text-danger-ink"
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            <Trash2 className="size-4" aria-hidden /> {t('admin.logo.remove')}
          </Button>
        )}
      </div>
      <p className="text-caption text-fg-3">{t('admin.logo.hint', { kb: LOGO_MAX_BYTES / 1024 })}</p>
    </div>
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
        <p className="text-meta text-fg-2">{t('admin.brandingIntro')}</p>
        <LogoField monogram={b.monogram} name={b.displayName} />
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
          <Crest monogram={b.monogram || '?'} logoUrl={tenant.logoUrl} label={b.displayName} size={48} />
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
        <ul className="grid gap-1 font-mono text-caption text-fg-2">
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
        <p className="text-meta text-fg-2">{t('admin.featuresIntro')}</p>
        <ul className="grid gap-2">
          {(Object.keys(FEATURES) as Feature[]).map((f) => (
            <li key={f} className="rounded-[var(--radius-md)] bg-surface-2 px-3 py-1">
              <Switch
                label={t(`feature.${f}`)}
                checked={settings.data.features[f]}
                onChange={(on) => save.mutate({ features: { [f]: on } })}
              />
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
      <table className="w-full min-w-[620px] text-left text-meta">
        <thead className="border-b border-line text-caption text-fg-3">
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
              <td className="px-4 py-2.5 font-mono text-caption whitespace-nowrap tabular">
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
              <td className="px-4 py-2.5 font-mono text-caption text-fg-2">
                {r.targetType ? `${r.targetType}:${r.targetId?.slice(-6) ?? ''}` : '—'}
              </td>
              <td className="px-4 py-2.5 font-mono text-caption text-fg-3">{r.ipPrefix ?? '—'}</td>
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
