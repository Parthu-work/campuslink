import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import type { SsoProviderSettingsView, SsoSettingsView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input, PasswordInput } from '../../components/ui/field';
import { Card, Skeleton } from '../../components/ui/misc';
import { Switch } from '../../components/ui/switch';
import { api, ApiError } from '../../lib/api';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';

const KEY = ['admin-sign-in'];

function ProviderCard({ p, canEnable }: { p: SsoProviderSettingsView; canEnable: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(p.enabled);
  const [clientId, setClientId] = useState(p.clientId ?? '');
  const [secret, setSecret] = useState('');
  const [directoryId, setDirectoryId] = useState(p.directoryId ?? '');
  const name = t(`reach.admin.${p.provider}`);
  const save = useMutation({
    mutationFn: () =>
      api.put<SsoSettingsView>(`/admin/sign-in/${p.provider}`, {
        enabled,
        clientId: clientId.trim(),
        ...(secret.trim() ? { clientSecret: secret.trim() } : {}),
        ...(p.provider === 'microsoft' && directoryId.trim() ? { directoryId: directoryId.trim() } : {}),
      }),
    onSuccess: (v) => {
      qc.setQueryData(KEY, v);
      setSecret('');
      toast.success(t('reach.admin.saved'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <Card variant="raised" className="grid gap-4 p-5" role="region" aria-labelledby={`sso-${p.provider}`}>
      <h2 id={`sso-${p.provider}`} className="text-title font-semibold">
        {name}
      </h2>
      <p className="text-meta text-fg-2">
        {p.provider === 'google' ? t('reach.admin.howGoogle') : t('reach.admin.howMicrosoft')}
      </p>
      <Field label={t('reach.admin.redirect')}>
        {({ id }) => (
          <div className="flex gap-2">
            <Input
              id={id}
              readOnly
              value={p.redirectUri}
              className="font-mono text-caption"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              size="icon"
              aria-label={t('reach.admin.copy')}
              onClick={() =>
                void navigator.clipboard
                  .writeText(p.redirectUri)
                  .then(() => toast.success(t('reach.admin.copied')))
                  .catch(() => undefined)
              }
            >
              <Copy className="size-4" aria-hidden />
            </Button>
          </div>
        )}
      </Field>
      <Field label={t('reach.admin.clientId')}>
        {({ id }) => (
          <Input id={id} value={clientId} autoComplete="off" onChange={(e) => setClientId(e.target.value)} />
        )}
      </Field>
      <Field
        label={t('reach.admin.clientSecret')}
        hint={p.hasSecret ? t('reach.admin.secretKept') : undefined}
      >
        {({ id, describedBy }) => (
          <PasswordInput
            id={id}
            aria-describedby={describedBy}
            autoComplete="new-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        )}
      </Field>
      {p.provider === 'microsoft' && (
        <Field label={t('reach.admin.directoryId')}>
          {({ id }) => (
            <Input
              id={id}
              value={directoryId}
              autoComplete="off"
              onChange={(e) => setDirectoryId(e.target.value)}
            />
          )}
        </Field>
      )}
      <Switch
        checked={enabled}
        disabled={!canEnable && !enabled}
        onChange={setEnabled}
        label={t('reach.admin.enabled', { provider: name })}
      />
      <div>
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={clientId.trim().length < 8}
          onClick={() => save.mutate()}
        >
          {t('reach.admin.save')}
        </Button>
      </div>
    </Card>
  );
}

/** Admin › Sign-in options (prompt 2, G9): Google Workspace and Microsoft Entra ID sign-in. */
export function SignInAdmin() {
  const { t } = useTranslation();
  const q = useQuery({
    ...SCREEN,
    queryKey: KEY,
    queryFn: ({ signal }) => api.get<SsoSettingsView>('/admin/sign-in', signal),
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64" />;
  const domains = q.data.allowedEmailDomains;
  return (
    <div className="grid gap-5">
      <p className="text-meta text-fg-2">{t('reach.admin.intro')}</p>
      <p className="text-meta font-semibold">
        {domains.length
          ? t('reach.admin.domains', { domains: domains.join(', ') })
          : t('reach.admin.noDomains')}
      </p>
      <p className="text-caption text-fg-3">{t('reach.admin.mfa')}</p>
      {q.data.providers.map((p) => (
        <ProviderCard key={p.provider} p={p} canEnable={domains.length > 0} />
      ))}
    </div>
  );
}
