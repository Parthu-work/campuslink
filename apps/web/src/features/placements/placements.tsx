import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Building2, CalendarClock, GraduationCap } from 'lucide-react';
import type { DriveView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { IntentLink } from '../../components/ui/intent-link';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { formatDay, formatRelative } from '../../lib/format';
import { useCan } from '../../lib/me';
import { closesSoon, driveCtc, isRegistered } from '../../lib/placements';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { CompanyMark } from '../jobs/job-card';
import { OutcomesPanel } from '../outcomes/outcomes-panel';

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
        {tab === 'offers' ? <OutcomesPanel /> : <DriveList scope={tab} />}
      </TabPanel>
      <p className="flex items-center gap-1.5 text-caption text-fg-3">
        <BadgeCheck className="size-4" aria-hidden /> {t('placements.privacyNote')}
      </p>
    </div>
  );
}
