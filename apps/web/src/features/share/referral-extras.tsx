import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { REFERRAL_OUTCOMES, type ReferralOutcome, type ReferralView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Card } from '../../components/ui/misc';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { api, ApiError } from '../../lib/api';
import * as q from '../../lib/queries';
import { toast } from '../../lib/toast';

/** On a referral the student received: what came of it (prompt 2, G8). */
export function ReferralOutcomePicker({ r }: { r: ReferralView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (outcome: ReferralOutcome) =>
      api.post<ReferralView>(`/referrals/${r.id}/outcome`, { outcome }),
    onSuccess: () => {
      toast.success(t('share.referral.saved'));
      void qc.invalidateQueries({ queryKey: ['referrals'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <ChoiceGroup
      label={t('share.referral.ask')}
      value={save.variables ?? r.outcome ?? null}
      onChange={(o) => save.mutate(o)}
      variant="chip"
      options={REFERRAL_OUTCOMES.map((o) => ({ value: o, label: t(`share.referral.outcome.${o}`) }))}
    />
  );
}

/** For alumni who refer: what their referrals led to, from what students reported (prompt 2, G8). */
export function ReferralImpact() {
  const { t } = useTranslation();
  const v = useQuery(q.referralImpact());
  if (!v.data || !v.data.referred) return null;
  return (
    <Card variant="raised" className="grid gap-3 p-4">
      <h2 className="text-body font-semibold">{t('share.referral.impactTitle')}</h2>
      <StatGrid>
        <StatCard size="sm" label={t('share.referral.referred')} value={v.data.referred} />
        <StatCard size="sm" label={t('share.referral.interviews')} value={v.data.interviews} />
        <StatCard size="sm" label={t('share.referral.offers')} value={v.data.offers} tone="brand" />
      </StatGrid>
      <p className="text-caption text-fg-3">{t('share.referral.impactNote')}</p>
    </Card>
  );
}
