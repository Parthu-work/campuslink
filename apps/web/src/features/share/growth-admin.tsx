import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { MEMBER_INVITES_PER_WEEK, type GrowthSettingsView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Checkbox } from '../../components/ui/field';
import { ErrorState } from '../../components/ui/error-state';
import { Card, Skeleton } from '../../components/ui/misc';
import { Switch } from '../../components/ui/switch';
import { api, ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { useCan } from '../../lib/me';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';

function OutcomesPreview() {
  const { t } = useTranslation();
  const v = useQuery(q.adminOutcomesPreview());
  if (v.isLoading) return <Skeleton className="h-32" />;
  const o = v.data;
  if (!o || !o.years.length) return <p className="text-meta text-fg-2">{t('share.admin.noData')}</p>;
  return (
    <div className="grid gap-3">
      <h3 className="text-body font-semibold">{t('share.admin.preview')}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-meta">
          <thead>
            <tr className="text-left text-fg-3">
              <th className="py-1 pr-3 font-semibold">{t('share.admin.year')}</th>
              <th className="py-1 pr-3 font-semibold">{t('share.admin.placementPct')}</th>
              <th className="py-1 pr-3 font-semibold">{t('share.admin.placed')}</th>
              <th className="py-1 font-semibold">{t('share.admin.median')}</th>
            </tr>
          </thead>
          <tbody>
            {o.years.map((y) => (
              <tr key={y.gradYear} className="border-t border-line">
                <td className="py-1.5 pr-3">{y.gradYear}</td>
                <td className="py-1.5 pr-3">{y.placementPct === null ? '—' : `${y.placementPct}%`}</td>
                <td className="py-1.5 pr-3">{y.placed}</td>
                <td className="py-1.5">{y.medianBand ? t(`reports.band.${y.medianBand}`) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {o.recruiters.length > 0 && (
        <p className="text-meta">
          <b>{t('share.admin.recruiters')}:</b>{' '}
          {o.recruiters.map((r) => `${r.company} (${r.offers})`).join(', ')}
        </p>
      )}
      {o.alumniAt.length > 0 && (
        <p className="text-meta">
          <b>{t('share.admin.alumniAt')}:</b> {o.alumniAt.map((r) => `${r.company} (${r.alumni})`).join(', ')}
        </p>
      )}
      <p className="text-meta">{t('share.admin.mentoringHours', { n: o.mentoringHours })}</p>
    </div>
  );
}

/** /admin/growth: member invites (with the college's opt-in confirmation) and the outcomes page (G8). */
export function GrowthAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canSettings = useCan('tenant:settings');
  const v = useQuery({ ...SCREEN, ...q.adminGrowth() });
  const [attest, setAttest] = useState(false);
  const saved = (s: GrowthSettingsView) => {
    qc.setQueryData(q.adminGrowth().queryKey, s);
    toast.success(t('share.admin.saved'));
  };
  const failed = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const invites = useMutation({
    mutationFn: (enabled: boolean) =>
      api.put<GrowthSettingsView>('/admin/growth/member-invites', {
        enabled,
        attestOptIn: enabled && attest,
      }),
    onSuccess: saved,
    onError: failed,
  });
  const outcomes = useMutation({
    mutationFn: (enabled: boolean) => api.put<GrowthSettingsView>('/admin/growth/outcomes-page', { enabled }),
    onSuccess: saved,
    onError: failed,
  });
  if (v.isError) return <ErrorState error={v.error} onRetry={() => void v.refetch()} />;
  const s = v.data;
  return (
    <div className="grid gap-5">
      <p className="text-meta text-fg-2">{t('share.admin.intro')}</p>
      {!s && <Skeleton className="h-48" />}
      {s && (
        <Card variant="raised" className="grid gap-3 p-4 sm:p-6">
          <h2 className="text-title font-semibold">{t('share.admin.invitesTitle')}</h2>
          <p className="text-meta text-fg-2">
            {t('share.admin.invitesBody', { n: MEMBER_INVITES_PER_WEEK })}
          </p>
          {!s.memberInvites.enabled && (
            <Checkbox id="growth-attest" checked={attest} onChange={setAttest}>
              {t('share.admin.attest')}
            </Checkbox>
          )}
          <Switch
            checked={s.memberInvites.enabled}
            disabled={invites.isPending || (!s.memberInvites.enabled && !attest)}
            onChange={(on) => invites.mutate(on)}
            label={t('share.admin.invitesSwitch')}
            description={
              s.memberInvites.enabled && s.memberInvites.attestedAt
                ? t('share.admin.attestedOn', { date: formatDay(s.memberInvites.attestedAt) })
                : t('share.admin.attestNeeded')
            }
          />
        </Card>
      )}
      {s && canSettings && (
        <Card variant="raised" className="grid gap-3 p-4 sm:p-6">
          <h2 className="text-title font-semibold">{t('share.admin.outcomesTitle')}</h2>
          <p className="text-meta text-fg-2">{t('share.admin.outcomesBody')}</p>
          <Switch
            checked={s.outcomesPage.enabled}
            disabled={outcomes.isPending}
            onChange={(on) => outcomes.mutate(on)}
            label={t('share.admin.outcomesSwitch')}
          />
          {s.outcomesPage.enabled && s.outcomesPage.url && (
            <a
              href={s.outcomesPage.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 text-meta font-semibold text-brand-ink underline"
            >
              <ExternalLink className="size-4" aria-hidden /> {t('share.admin.outcomesLink')}
            </a>
          )}
          <OutcomesPreview />
        </Card>
      )}
    </div>
  );
}
