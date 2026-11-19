import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CalendarClock, CheckCircle2 } from 'lucide-react';
import type { AcademicRecordView, DriveView, MyRegistrationView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Countdown } from '../../components/ui/countdown';
import { Sheet } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { IntentLink } from '../../components/ui/intent-link';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { api, ApiError } from '../../lib/api';
import { formatDay, newIdempotencyKey } from '../../lib/format';
import { useCan } from '../../lib/me';
import { currentRound, DRIVE_KEYS, driveCtc, isRegistered, reasonText } from '../../lib/placements';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import { CompanyMark } from '../jobs/job-card';
import { OutcomesPanel } from '../outcomes/outcomes-panel';

const AcademicDialog = lazy(() => import('./academic-dialog').then((m) => ({ default: m.AcademicDialog })));

type Tab = q.DriveScope | 'offers';
const TABS: readonly Tab[] = ['eligible', 'all', 'registered', 'offers'];
/** Registration closing within this is shown warm (U7). */
const URGENT_MS = 48 * 3600_000;
/** The link covers its card (the Register button sits above it). */
const STRETCHED =
  'outline-none after:absolute after:inset-0 after:rounded-[var(--radius-lg)] after:content-[""] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[var(--focus-ring)]';

/** Where the student stands on a drive, in one line. */
function StandLine({ drive: d }: { drive: DriveView }) {
  const { t } = useTranslation();
  const reg = d.myRegistration;
  if (isRegistered(d) && reg) {
    if (reg.final === 'selected' || reg.final === 'not_selected')
      return (
        <p className="text-callout font-semibold text-fg-2">
          {reg.final === 'selected' ? (
            <span className="text-success-ink">{t('placements.final.selected')}</span>
          ) : (
            t('placements.final.not_selected')
          )}
        </p>
      );
    const round = currentRound(d);
    const r = d.rounds[round];
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-callout">
        <Badge tone="success">{t('placements.registered')}</Badge>
        {d.status === 'in_progress' && r && (
          <span className="text-fg-2">
            {t('drives.card.round', { n: round + 1, total: d.rounds.length, name: r.name })}
          </span>
        )}
      </p>
    );
  }
  if (!d.registrationOpen) return null;
  if (d.eligible || d.overridden)
    return (
      <p className="flex items-center gap-1.5 text-callout font-semibold text-success-ink">
        <CheckCircle2 className="size-4 flex-none" aria-hidden />
        {d.eligible ? t('placements.youAreEligible') : t('placements.letInCanRegister')}
      </p>
    );
  const [first, ...rest] = d.reasons;
  return (
    <p className="text-callout text-pretty text-fg-2">
      {first ? reasonText(t, first) : t('placements.notEligible')}
      {rest.length > 0 && <span className="text-fg-3"> {t('drives.card.more', { count: rest.length })}</span>}
    </p>
  );
}

/**
 * Register from the card (U7): one tap for a drive with no questions and no résumé (with Undo,
 * which withdraws); otherwise the drive opens with its registration sheet.
 */
function CardRegister({ drive: d }: { drive: DriveView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canRegister = useCan('placements:register');
  const refresh = () => {
    for (const queryKey of DRIVE_KEYS) void qc.invalidateQueries({ queryKey });
  };
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const withdraw = useMutation({
    mutationFn: () => api.post<MyRegistrationView>(`/placements/drives/${d.id}/withdraw`, {}),
    onSuccess: () => {
      refresh();
      toast(t('drives.card.withdrawn'));
    },
    onError: fail,
  });
  const register = useMutation({
    mutationFn: () =>
      api.postOnce<MyRegistrationView>(`/placements/drives/${d.id}/register`, {}, newIdempotencyKey()),
    onSuccess: (r) => {
      qc.setQueryData<DriveView>(['placement-drive', d.id], (v) => (v ? { ...v, myRegistration: r } : v));
      refresh();
      toast.undo(t('placements.registeredToast', { company: d.company.name }), t('ui.undo'), () =>
        withdraw.mutate(),
      );
    },
    onError: fail,
  });
  if (!canRegister || isRegistered(d) || !d.registrationOpen || !(d.eligible || d.overridden)) return null;
  const label = t('drives.card.registerLabel', { company: d.company.name, title: d.title });
  const oneTap = !d.resumeRequired && !d.questions.length;
  return (
    <div className="relative z-[1] grid sm:flex sm:justify-end">
      {oneTap ? (
        <Button
          variant="primary"
          aria-label={label}
          loading={register.isPending}
          onClick={() => register.mutate()}
        >
          {t('placements.register')}
        </Button>
      ) : (
        <IntentLink
          to={`/placements/${d.id}?register=1`}
          aria-label={label}
          className={buttonVariants({ variant: 'primary' })}
        >
          {t('placements.register')}
        </IntentLink>
      )}
    </div>
  );
}

/** One drive in a list: company, role, pay, the countdown, where the viewer stands, and Register. */
function DriveCard({ drive: d }: { drive: DriveView }) {
  const { t } = useTranslation();
  const pay = driveCtc(t, d);
  return (
    <li>
      <Card variant="interactive" className="relative grid h-full content-start gap-3 p-4">
        <div className="flex items-start gap-3">
          <CompanyMark name={d.company.name} transitionName={`drive-${d.id}`} />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <h3 className="text-body leading-snug font-semibold text-pretty break-words">
              <IntentLink to={`/placements/${d.id}`} className={STRETCHED}>
                {d.company.name}
              </IntentLink>
            </h3>
            <p className="text-callout text-pretty break-words text-fg-2">{d.title}</p>
          </div>
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-callout text-fg-2">
          {pay && <span className="font-semibold text-fg">{pay}</span>}
          {pay && <span aria-hidden>·</span>}
          <span>{t(`placements.mode.${d.mode}`)}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-4" aria-hidden /> {formatDay(d.driveDate)}
          </span>
        </p>
        {(d.status !== 'open' || (d.registrationOpen && !isRegistered(d))) && (
          <div className="flex flex-wrap items-center gap-2">
            {d.registrationOpen && !isRegistered(d) && (
              <Countdown at={d.registrationCloseAt} urgentWithinMs={URGENT_MS} />
            )}
            {d.status !== 'open' && <Badge>{t(`placements.status.${d.status}`)}</Badge>}
          </div>
        )}
        <StandLine drive={d} />
        <CardRegister drive={d} />
      </Card>
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
          <Skeleton key={i} className="h-52 rounded-[var(--radius-lg)]" />
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

/** Every figure of the record, where it came from, and (only when it is not the college's) adding it. */
function RecordSheet({
  record: r,
  open,
  onOpenChange,
  onEdit,
}: {
  record: AcademicRecordView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const fromCollege = !!r && r.source !== 'self';
  const pct = (n: number | null) => (n === null ? '—' : `${n}%`);
  const facts: [string, string][] = r
    ? [
        [t('placements.field.cgpa'), r.cgpa === null ? '—' : String(r.cgpa)],
        [t('placements.field.activeBacklogs'), r.activeBacklogs === null ? '—' : String(r.activeBacklogs)],
        [t('placements.field.historyBacklogs'), r.historyBacklogs === null ? '—' : String(r.historyBacklogs)],
        [t('placements.field.tenthPct'), pct(r.tenthPct)],
        r.twelfthPct === null && r.diplomaPct !== null
          ? [t('placements.field.diplomaPct'), pct(r.diplomaPct)]
          : [t('placements.field.twelfthPct'), pct(r.twelfthPct)],
      ]
    : [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('placements.record')}>
      <div className="grid gap-4">
        {r && (
          <Badge tone={r.verified ? 'success' : 'warning'} className="w-fit">
            {r.verified
              ? fromCollege
                ? t('placements.recordFromCollege')
                : t('placements.recordVerified')
              : t('placements.recordPending')}
          </Badge>
        )}
        {r && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {facts.map(([k, v]) => (
              <div key={k} className="grid gap-0.5">
                <dt className="text-caption text-fg-3">{k}</dt>
                <dd className="font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {fromCollege ? (
          <p className="text-callout text-fg-2">{t('placements.recordCorrections')}</p>
        ) : (
          <>
            <p className="text-callout text-fg-2">{t('drives.record.fromCell')}</p>
            <p className="text-callout text-fg-2">{t('drives.record.selfIntro')}</p>
            <Button variant="secondary" className="w-fit" onClick={onEdit}>
              {r ? t('placements.recordEdit') : t('placements.recordAdd')}
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/**
 * The student's academic record in one row (U7): CGPA and backlogs as the college gave them and
 * where they came from. Nothing here asks for marks; adding them yourself is inside the sheet,
 * only where the record is not the college's.
 */
function RecordRow() {
  const { t } = useTranslation();
  const rec = useQuery(q.myAcademics());
  const [sheet, setSheet] = useState(false);
  const [editing, setEditing] = useState(false);
  if (rec.isLoading) return <Skeleton className="h-[4.5rem] rounded-[var(--radius-md)]" />;
  if (rec.isError) return null;
  const r = rec.data ?? null;
  const facts = r
    ? [
        r.cgpa !== null ? t('drives.record.cgpa', { cgpa: r.cgpa }) : '',
        r.activeBacklogs !== null ? t('drives.record.backlogs', { count: r.activeBacklogs }) : '',
      ].filter(Boolean)
    : [];
  const meta = !r
    ? t('drives.record.noneMeta')
    : r.verified
      ? r.source !== 'self'
        ? t('placements.recordFromCollege')
        : t('placements.recordVerified')
      : t('placements.recordPending');
  return (
    <>
      <ListSection>
        <ListRow
          title={
            <span className="tabular-nums">{facts.length ? facts.join(' · ') : t('drives.record.none')}</span>
          }
          meta={meta}
          trailing={
            <Button
              size="sm"
              variant="secondary"
              aria-label={t('drives.record.viewLabel')}
              onClick={() => setSheet(true)}
            >
              {t('drives.record.view')}
            </Button>
          }
        />
      </ListSection>
      <RecordSheet
        record={r}
        open={sheet}
        onOpenChange={setSheet}
        onEdit={() => {
          setSheet(false);
          setEditing(true);
        }}
      />
      {editing && (
        <Suspense fallback={null}>
          <AcademicDialog record={r} onClose={() => setEditing(false)} />
        </Suspense>
      )}
    </>
  );
}

/**
 * Placements (B7; prompt 3, U7): the record in one row, then drives the student is eligible for,
 * every drive (with why not), the ones they registered for, and their offers. Register on the card.
 */
export function PlacementsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const canOffers = useCan('outcomes:report');
  const canRecord = useCan('placements:register');
  const tabs = TABS.filter((x) => x !== 'offers' || canOffers);
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = asked && tabs.includes(asked) ? asked : 'eligible';
  const idBase = 'placements';
  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-4">
      <PageHeader title={t('nav.placements')} about={t('placements.intro')} />
      {canRecord && <RecordRow />}
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
        <BadgeCheck className="size-4 flex-none" aria-hidden /> {t('placements.privacyNote')}
      </p>
    </div>
  );
}
