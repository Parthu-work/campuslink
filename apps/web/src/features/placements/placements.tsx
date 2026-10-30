import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Building2, CalendarClock, FilePlus2, GraduationCap } from 'lucide-react';
import type { DriveView, OfferView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { IntentLink } from '../../components/ui/intent-link';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { api, ApiError } from '../../lib/api';
import { celebrate, firstSighting } from '../../lib/celebrate';
import { formatDay, formatRelative } from '../../lib/format';
import { useCan } from '../../lib/me';
import { closesSoon, ctcExact, driveCtc, isRegistered } from '../../lib/placements';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import { CompanyMark } from '../jobs/job-card';

const OfferReportDialog = lazy(() =>
  import('./offer-report').then((m) => ({ default: m.OfferReportDialog })),
);
const AcademicDialog = lazy(() => import('./academic-dialog').then((m) => ({ default: m.AcademicDialog })));

type Tab = q.DriveScope | 'offers';
const TABS: readonly Tab[] = ['eligible', 'all', 'registered', 'offers'];

/** One drive in a list: company, pay, when registration closes, and where the viewer stands. */
function DriveCard({ drive: d }: { drive: DriveView }) {
  const { t } = useTranslation();
  const pay = driveCtc(t, d);
  const registered = isRegistered(d);
  return (
    <li>
      <IntentLink to={`/placements/${d.id}`} className="block rounded-[var(--radius-lg)]">
        <Card variant="interactive" className="grid gap-2.5 p-4">
          <div className="flex items-start gap-3">
            <CompanyMark name={d.company.name} />
            <div className="min-w-0 flex-1">
              <h3 className="text-body leading-snug font-semibold">{d.company.name}</h3>
              <p className="truncate text-meta text-fg-2">{d.title}</p>
            </div>
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-2">
            {pay && <span className="font-semibold text-fg">{pay}</span>}
            <span>· {t(`placements.mode.${d.mode}`)}</span>
            <span className="inline-flex items-center gap-1">
              · <CalendarClock className="size-3.5" aria-hidden /> {formatDay(d.driveDate)}
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {registered && <Badge tone="success">{t('placements.registered')}</Badge>}
            {d.myRegistration?.final === 'selected' && (
              <Badge tone="brand">{t('placements.final.selected')}</Badge>
            )}
            {!registered && d.registrationOpen && !d.eligible && !d.overridden && (
              <Badge>{t('placements.notEligible')}</Badge>
            )}
            {!registered && closesSoon(d) && (d.eligible || d.overridden) && (
              <Badge tone="warning">
                {t('placements.closes', { when: formatRelative(d.registrationCloseAt) })}
              </Badge>
            )}
            {d.status !== 'open' && <Badge>{t(`placements.status.${d.status}`)}</Badge>}
          </div>
        </Card>
      </IntentLink>
    </li>
  );
}

function DriveList({ scope }: { scope: q.DriveScope }) {
  const { t } = useTranslation();
  const list = useQuery({ ...SCREEN, ...q.placementDrives(scope) });
  if (list.isLoading)
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-36 rounded-[var(--radius-lg)]" />
        ))}
      </div>
    );
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  const rows = list.data ?? [];
  if (!rows.length)
    return (
      <EmptyState
        art={<Illustration kind={scope === 'registered' ? 'calendar' : 'empty'} />}
        title={t(`placements.empty.${scope}`)}
      >
        {t(`placements.emptyBody.${scope}`)}
      </EmptyState>
    );
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {rows.map((d) => (
        <DriveCard key={d.id} drive={d} />
      ))}
    </ul>
  );
}

/** The student's academic record: what eligibility is checked against, and who stands behind it. */
function AcademicCard() {
  const { t } = useTranslation();
  const canReport = useCan('placements:register');
  const rec = useQuery(q.myAcademics());
  const [open, setOpen] = useState(false);
  if (rec.isLoading) return <Skeleton className="h-28 rounded-[var(--radius-lg)]" />;
  if (rec.isError) return null;
  const r = rec.data ?? null;
  const fromCollege = r && r.source !== 'self';
  const facts: [string, string][] = r
    ? [
        [t('placements.field.cgpa'), r.cgpa === null ? '—' : String(r.cgpa)],
        [t('placements.field.activeBacklogs'), r.activeBacklogs === null ? '—' : String(r.activeBacklogs)],
        [t('placements.field.tenthPct'), r.tenthPct === null ? '—' : `${r.tenthPct}%`],
        [
          r.twelfthPct === null && r.diplomaPct !== null
            ? t('placements.field.diplomaPct')
            : t('placements.field.twelfthPct'),
          r.twelfthPct !== null ? `${r.twelfthPct}%` : r.diplomaPct !== null ? `${r.diplomaPct}%` : '—',
        ],
      ]
    : [];
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <GraduationCap className="size-5 text-brand-ink" aria-hidden /> {t('placements.record')}
        </h2>
        {r && (
          <Badge tone={r.verified ? 'success' : 'warning'}>
            {r.verified
              ? fromCollege
                ? t('placements.recordFromCollege')
                : t('placements.recordVerified')
              : t('placements.recordPending')}
          </Badge>
        )}
      </div>
      {r ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {facts.map(([k, v]) => (
            <div key={k} className="grid gap-0.5">
              <dt className="text-caption text-fg-3">{k}</dt>
              <dd className="font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-meta text-fg-2">{t('placements.recordNone')}</p>
      )}
      {canReport && !fromCollege && (
        <div>
          <Button size="sm" onClick={() => setOpen(true)}>
            {r ? t('placements.recordEdit') : t('placements.recordAdd')}
          </Button>
        </div>
      )}
      {fromCollege && <p className="text-caption text-fg-3">{t('placements.recordCorrections')}</p>}
      {open && (
        <Suspense fallback={null}>
          <AcademicDialog record={r} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </Card>
  );
}

function OfferRow({ offer: o }: { offer: OfferView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const decline = useMutation({
    mutationFn: () => api.post<OfferView>(`/placements/offers/${o.id}/decline`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['my-offers'] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
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
  const verified = (offers.data ?? []).filter((o) => o.status === 'verified').map((o) => o.id);
  const verifiedKey = verified.join(',');
  // A verified offer is a moment (ADR 0008): celebrated once per device, never a decline.
  useEffect(() => {
    const ids = verifiedKey ? verifiedKey.split(',') : [];
    if (ids.length && firstSighting('verified-offers', ids)) celebrate(firstRef.current);
  }, [verifiedKey]);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[60ch] text-meta text-fg-2">{t('placements.offersIntro')}</p>
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
    </div>
  );
}

/**
 * Placements (B7): drives the student is eligible for, every drive (with why not), the ones they
 * registered for, and their offers. Final-year students have this as a main tab.
 */
export function PlacementsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const canOffers = useCan('outcomes:report');
  const tabs = TABS.filter((x) => x !== 'offers' || canOffers);
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = asked && tabs.includes(asked) ? asked : 'eligible';
  const idBase = 'placements';
  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-5">
      <PageHeader icon={<Building2 />} title={t('nav.placements')} intro={t('placements.intro')} />
      <AcademicCard />
      <Tabs<Tab>
        label={t('placements.tabsLabel')}
        idBase={idBase}
        value={tab}
        onChange={(v) => setParams(v === 'eligible' ? {} : { tab: v }, { replace: true })}
        tabs={tabs.map((id) => ({ id, label: t(`placements.tab.${id}`) }))}
      />
      <TabPanel idBase={idBase} id={tab}>
        {tab === 'offers' ? <Offers /> : <DriveList scope={tab} />}
      </TabPanel>
      <p className="flex items-center gap-1.5 text-caption text-fg-3">
        <BadgeCheck className="size-4" aria-hidden /> {t('placements.privacyNote')}
      </p>
    </div>
  );
}
