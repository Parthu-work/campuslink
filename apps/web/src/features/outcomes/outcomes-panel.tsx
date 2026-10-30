import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, Plus, Trash2 } from 'lucide-react';
import type { OfferView, OutcomeKind, OutcomeView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { celebrate, firstSighting } from '../../lib/celebrate';
import { formatDay } from '../../lib/format';
import { OUTCOME_TONE, outcomeDetail, outcomeTitle } from '../../lib/outcomes';
import { ctcExact } from '../../lib/placements';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import { CompanyMark } from '../jobs/job-card';

const OfferReportDialog = lazy(() =>
  import('../placements/offer-report').then((m) => ({ default: m.OfferReportDialog })),
);
const OutcomeDialog = lazy(() => import('./outcome-dialog').then((m) => ({ default: m.OutcomeDialog })));

const fail = (t: (k: string) => string) => (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'));

function OfferRow({ offer: o }: { offer: OfferView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const decline = useMutation({
    mutationFn: () => api.post<OfferView>(`/placements/offers/${o.id}/decline`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['my-offers'] }),
    onError: fail(t),
  });
  const tone = {
    verified: 'success',
    reported: 'warning',
    rejected: 'danger',
    declined_by_student: 'neutral',
  } as const;
  return (
    <li>
      <Card variant="raised" className="grid gap-2 p-4">
        <div className="flex items-start gap-3">
          <CompanyMark name={o.companyName} />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">{o.companyName}</h3>
            <p className="text-meta text-fg-2">
              {o.role} · {t(`placements.roleType.${o.type}`)}
            </p>
          </div>
          <Badge tone={tone[o.status]}>{t(`placements.offerStatus.${o.status}`)}</Badge>
        </div>
        <p className="flex flex-wrap gap-x-2 text-meta">
          <span className="font-semibold tabular-nums">{ctcExact(t, o.ctcLpa)}</span>
          <span className="text-fg-2">· {t(`placements.source.${o.source}`)}</span>
          <span className="text-fg-2">· {formatDay(o.offerDate)}</span>
        </p>
        {o.status === 'rejected' && o.reason && (
          <p className="rounded-[var(--radius-md)] bg-danger-surface p-3 text-meta text-danger-ink">
            {t('placements.rejectedBecause', { reason: o.reason })}
          </p>
        )}
        {(o.status === 'verified' || o.status === 'reported') && (
          <div>
            <Button size="sm" variant="ghost" loading={decline.isPending} onClick={() => decline.mutate()}>
              {t('placements.declineOffer')}
            </Button>
          </div>
        )}
      </Card>
    </li>
  );
}

function Offers() {
  const { t } = useTranslation();
  const offers = useQuery({ ...SCREEN, ...q.myOffers() });
  const [reporting, setReporting] = useState(false);
  const firstRef = useRef<HTMLUListElement>(null);
  const verifiedKey = (offers.data ?? [])
    .filter((o) => o.status === 'verified')
    .map((o) => o.id)
    .join(',');
  // A verified offer is a moment (ADR 0008): celebrated once per device, never a decline.
  useEffect(() => {
    const ids = verifiedKey ? verifiedKey.split(',') : [];
    if (ids.length && firstSighting('verified-offers', ids)) celebrate(firstRef.current);
  }, [verifiedKey]);
  return (
    <section aria-labelledby="outcomes-offers" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-1">
          <h2 id="outcomes-offers" className="text-title font-semibold">
            {t('outcomes.offers')}
          </h2>
          <p className="max-w-[60ch] text-meta text-fg-2">{t('placements.offersIntro')}</p>
        </div>
        <Button variant="primary" onClick={() => setReporting(true)}>
          <FilePlus2 className="size-4" aria-hidden /> {t('placements.reportOffer')}
        </Button>
      </div>
      {offers.isLoading && <Skeleton className="h-32 rounded-[var(--radius-lg)]" />}
      {offers.isError && <ErrorState error={offers.error} onRetry={() => void offers.refetch()} />}
      {offers.isSuccess && !offers.data.length && (
        <EmptyState art={<Illustration kind="empty" />} title={t('placements.noOffers')}>
          {t('placements.noOffersBody')}
        </EmptyState>
      )}
      {!!offers.data?.length && (
        <ul ref={firstRef} className="grid gap-3 sm:grid-cols-2">
          {offers.data.map((o) => (
            <OfferRow key={o.id} offer={o} />
          ))}
        </ul>
      )}
      {reporting && (
        <Suspense fallback={null}>
          <OfferReportDialog onClose={() => setReporting(false)} />
        </Suspense>
      )}
    </section>
  );
}

function OutcomeRow({ outcome: o }: { outcome: OutcomeView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.delete(`/me/outcomes/${o.kind}/${o.id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['my-outcomes'] }),
    onError: fail(t),
  });
  const title = outcomeTitle(t, o);
  return (
    <li>
      <Card variant="raised" className="grid gap-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-caption text-fg-3">{t(`outcomes.kind.${o.kind}`)}</p>
            <h3 className="font-semibold">{title}</h3>
            <p className="text-meta text-fg-2">{outcomeDetail(t, o)}</p>
          </div>
          <Badge tone={OUTCOME_TONE[o.status]}>{t(`outcomes.status.${o.status}`)}</Badge>
        </div>
        {o.status === 'rejected' && o.reason && (
          <p className="rounded-[var(--radius-md)] bg-danger-surface p-3 text-meta text-danger-ink">
            {t('placements.rejectedBecause', { reason: o.reason })}
          </p>
        )}
        {o.status !== 'verified' && (
          <div>
            <Button
              size="sm"
              variant="ghost"
              loading={remove.isPending}
              aria-label={t('outcomes.removeNamed', { title })}
              onClick={() => remove.mutate()}
            >
              <Trash2 className="size-4" aria-hidden /> {t('outcomes.remove')}
            </Button>
          </div>
        )}
      </Card>
    </li>
  );
}

function OtherOutcomes() {
  const { t } = useTranslation();
  const list = useQuery(q.myOutcomes());
  const [adding, setAdding] = useState<OutcomeKind | null>(null);
  const kinds: OutcomeKind[] = ['higher_study', 'exam', 'venture'];
  return (
    <section aria-labelledby="outcomes-other" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="outcomes-other" className="text-title font-semibold">
          {t('outcomes.otherTitle')}
        </h2>
        <p className="max-w-[60ch] text-meta text-fg-2">{t('outcomes.otherIntro')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <Button key={k} size="sm" onClick={() => setAdding(k)}>
            <Plus className="size-4" aria-hidden /> {t(`outcomes.add.${k}`)}
          </Button>
        ))}
      </div>
      {list.isLoading && <Skeleton className="h-24 rounded-[var(--radius-lg)]" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.isSuccess && !list.data.length && <p className="text-meta text-fg-3">{t('outcomes.none')}</p>}
      {!!list.data?.length && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.data.map((o) => (
            <OutcomeRow key={`${o.kind}-${o.id}`} outcome={o} />
          ))}
        </ul>
      )}
      {adding && (
        <Suspense fallback={null}>
          <OutcomeDialog kind={adding} onClose={() => setAdding(null)} />
        </Suspense>
      )}
    </section>
  );
}

/** Offers, then higher studies, exams and ventures (B8): what the member reports for the college's record. */
export function OutcomesPanel() {
  return (
    <div className="grid gap-8">
      <Offers />
      <OtherOutcomes />
    </div>
  );
}
