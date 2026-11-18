import { useDeferredValue, useState } from 'react';
import { Link, useParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareQuote, PenLine, Search } from 'lucide-react';
import type { CompanyGraphView, CompanyListItem, Count } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input } from '../../components/ui/field';
import { Illustration } from '../../components/ui/illustration';
import { IntentLink } from '../../components/ui/intent-link';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { Badge, Card, Chip, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { Table, Td, TdNum, Th, THead } from '../../components/ui/table';
import { api } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { useCan, useMe } from '../../lib/me';
import { prefs } from '../../lib/storage';
import { useFeature } from '../../lib/tenant-context';
import { toast } from '../../lib/toast';
import { LazySeniorsAt } from '../mentors/lazy-seniors';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { ExperienceCard } from './experience-card';

/** A suppressed count as shown ("<5" stays as it is). */
const shown = (n: Count) => String(n);

function ShareActions() {
  const { t } = useTranslation();
  if (!useCan('experiences:share')) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Link to="/experiences" className={buttonVariants({ variant: 'ghost' })}>
        {t('moat.mine')}
      </Link>
      <Link to="/experiences/new" className={buttonVariants({ variant: 'primary' })}>
        <PenLine className="size-4" aria-hidden /> {t('moat.share')}
      </Link>
    </div>
  );
}

const ASKED = 'targets-asked';
const sameCompany = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Which companies the student is aiming for, asked when Companies first opens (prompt 3, U7:
 * progressive profiling, moved from U4). The answer is the Alumni Match input it always was (private
 * to the student); "Not now" is remembered on this device.
 */
function TargetsQuestion({
  companies,
  current,
  goals,
}: {
  companies: CompanyListItem[];
  current: string[];
  goals: string[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [asked, setAsked] = useState(() => prefs.get(ASKED) === '1');
  const [picked, setPicked] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: () => api.put('/me/match-preferences', { goals, targetCompanies: picked }),
    onSuccess: () => {
      prefs.set(ASKED, '1');
      void qc.invalidateQueries({ queryKey: ['match-prefs'] });
      void qc.invalidateQueries({ queryKey: ['match'] });
      toast.success(t('moat.targets.saved'));
    },
    onError: () => toast.error(t('errors.generic')),
  });
  if (asked || current.length || !companies.length) return null;
  const options = companies.slice(0, 8);
  return (
    <Card className="grid gap-3 p-4">
      <div className="grid gap-1">
        <h2 id="targets-title" className="text-headline font-semibold">
          {t('moat.targets.title')}
        </h2>
        <p className="text-callout text-fg-2">{t('moat.targets.body')}</p>
      </div>
      <div role="group" aria-labelledby="targets-title" className="flex flex-wrap gap-2">
        {options.map((c) => {
          const on = picked.some((x) => sameCompany(x, c.name));
          return (
            <Chip
              key={c.key}
              pressed={on}
              onClick={() =>
                setPicked((p) =>
                  on ? p.filter((x) => !sameCompany(x, c.name)) : [...p, c.name].slice(0, 10),
                )
              }
            >
              {c.name}
            </Chip>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!picked.length}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          {t('moat.targets.save')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            prefs.set(ASKED, '1');
            setAsked(true);
          }}
        >
          {t('moat.targets.notNow')}
        </Button>
      </div>
    </Card>
  );
}

/** Companies from the Placement Graph (prompt 2, G10): where seniors went and who is there. */
export function CompaniesPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const list = useQuery({ ...SCREEN, ...q.companies(term), placeholderData: keepPreviousData });
  const me = useMe();
  const matchOn = useFeature('alumniMatch');
  const canAsk = useCan('mentorship:request');
  const student = !!me.data?.roles.includes('STUDENT');
  const targetsOn = matchOn && canAsk && student;
  const prefsQ = useQuery({ ...q.matchPreferences(), enabled: targetsOn });
  const targets = prefsQ.data?.targetCompanies ?? [];
  const isTarget = (name: string) => targets.some((x) => sameCompany(x, name));
  const items = [...(list.data?.items ?? [])].sort(
    (a, b) => Number(isTarget(b.name)) - Number(isTarget(a.name)),
  );
  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-5">
      <PageHeader title={t('nav.companies')} about={t('moat.intro')} actions={<ShareActions />} />
      {targetsOn && prefsQ.data && list.data && !term && (
        <TargetsQuestion companies={list.data.items} current={targets} goals={prefsQ.data.goals} />
      )}
      <Field label={t('moat.search')}>
        {({ id }) => (
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3"
              aria-hidden
            />
            <Input
              id={id}
              type="search"
              className="pl-9"
              maxLength={80}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
      </Field>
      {list.isLoading && <Skeleton className="h-48" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && (
        <>
          <p className="text-callout text-fg-3">
            {list.data.computedAt
              ? t('moat.updated', { date: formatDay(list.data.computedAt) })
              : t('moat.notYet')}{' '}
            {t('moat.small')}
          </p>
          {!list.data.items.length ? (
            term ? (
              <p className="text-body text-fg-2">{t('moat.noMatch', { q: term })}</p>
            ) : (
              <EmptyState art={<Illustration kind="empty" />} title={t('moat.none')}>
                {t('moat.noneBody')}
              </EmptyState>
            )
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {items.map((c) => (
                <li key={c.key}>
                  <Card variant="interactive" className="relative grid h-full gap-1.5 p-4">
                    <span className="flex flex-wrap items-center gap-2">
                      <IntentLink
                        to={`/companies/${encodeURIComponent(c.key)}`}
                        className="font-semibold text-pretty break-words after:absolute after:inset-0"
                      >
                        {c.name}
                      </IntentLink>
                      {isTarget(c.name) && <Badge tone="brand">{t('moat.targets.badge')}</Badge>}
                    </span>
                    <p className="flex flex-wrap gap-x-3 gap-y-1 text-callout text-fg-2">
                      {c.offers !== 0 && <span>{t('moat.placed', { n: shown(c.offers) })}</span>}
                      {!!c.batches.length && (
                        <span>{t('moat.batches', { years: c.batches.join(', ') })}</span>
                      )}
                      {c.alumni !== 0 && <span>{t('moat.alumni', { n: shown(c.alumni) })}</span>}
                    </p>
                    {!!c.experiences && (
                      <p className="flex items-center gap-1.5 text-callout text-brand-ink">
                        <MessageSquareQuote className="size-4" aria-hidden />
                        {t('moat.writeUps', { count: c.experiences })}
                      </p>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Figures({ g }: { g: CompanyGraphView }) {
  const { t } = useTranslation();
  return (
    <StatGrid>
      {g.offers !== 0 && <StatCard label={t('moat.stat.placed')} value={shown(g.offers)} />}
      {g.yourBranch && g.yourBranch.offers !== 0 && (
        <StatCard
          label={t('moat.stat.yourBranch', { branch: g.yourBranch.branch })}
          value={shown(g.yourBranch.offers)}
        />
      )}
      {g.alumni !== 0 && <StatCard label={t('moat.stat.alumni')} value={shown(g.alumni)} />}
      {g.mentors !== 0 && <StatCard label={t('moat.stat.mentors')} value={shown(g.mentors)} />}
      {g.drives !== 0 && <StatCard label={t('moat.stat.drives')} value={shown(g.drives)} />}
      {g.sessions !== 0 && <StatCard label={t('moat.stat.sessions')} value={shown(g.sessions)} />}
    </StatGrid>
  );
}

function Batches({ g }: { g: CompanyGraphView }) {
  const { t } = useTranslation();
  if (!g.batches.length) return null;
  return (
    <section aria-labelledby="company-batches" className="grid gap-2">
      <h2 id="company-batches" className="text-headline font-semibold">
        {t('moat.byBatch')}
      </h2>
      <Table label={t('moat.byBatch')}>
        <THead>
          <tr>
            <Th>{t('moat.batch')}</Th>
            <Th className="text-right">{t('moat.offers')}</Th>
            <Th>{t('moat.band')}</Th>
          </tr>
        </THead>
        <tbody>
          {g.batches.map((b) => (
            <tr key={b.gradYear}>
              <Td>{b.gradYear}</Td>
              <TdNum>{shown(b.offers)}</TdNum>
              <Td>
                {b.band ? (
                  t(`reports.band.${b.band}`)
                ) : (
                  <span className="text-fg-3">{t('moat.bandHidden')}</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {!!g.branches.length && (
        <p className="flex flex-wrap items-center gap-2 text-callout text-fg-2">
          <span className="font-semibold">{t('moat.byBranch')}:</span>
          {g.branches.map((b) => (
            <Badge key={b.branch} mono>
              {b.branch} {shown(b.offers)}
            </Badge>
          ))}
        </p>
      )}
    </section>
  );
}

function Rounds({ g }: { g: CompanyGraphView }) {
  const { t } = useTranslation();
  if (!g.rounds.length && g.referrals.referred === 0) return null;
  return (
    <section aria-labelledby="company-rounds" className="grid gap-3">
      {!!g.rounds.length && (
        <>
          <h2 id="company-rounds" className="text-headline font-semibold">
            {t('moat.rounds')}
          </h2>
          <ListSection>
            {g.rounds.map((r) => (
              <ListRow
                key={r.kind}
                title={t(`placements.roundKind.${r.kind}`)}
                meta={`${t('moat.sat', { n: shown(r.appeared) })} · ${
                  r.passRate === null ? t('moat.rateHidden') : t('moat.cleared', { pct: r.passRate })
                }`}
              />
            ))}
          </ListSection>
        </>
      )}
      {g.referrals.referred !== 0 && (
        <ListSection>
          <ListRow
            title={t('moat.referrals')}
            meta={
              <>
                {t('moat.referralLine', {
                  referred: shown(g.referrals.referred),
                  converted: shown(g.referrals.converted),
                })}
                {g.referrals.rate !== null && <> {t('moat.referralRate', { pct: g.referrals.rate })}</>}
              </>
            }
          />
        </ListSection>
      )}
    </section>
  );
}

/** A company page (prompt 2, G10): aggregates from verified records and seniors' write-ups. */
export function CompanyPage() {
  const { t } = useTranslation();
  const { key = '' } = useParams();
  const page = useQuery({ ...SCREEN, ...q.company(key) });
  const canAsk = useCan('mentorship:request');
  const canPractise = useCan('practice:use');
  const canShare = useCan('experiences:share');
  const g = page.data;
  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-5">
      <BackLink to="/companies">{t('nav.companies')}</BackLink>
      {page.isLoading && <Skeleton className="h-64" />}
      {page.isError && <ErrorState error={page.error} onRetry={() => void page.refetch()} />}
      {g && (
        <>
          <PageHeader
            title={g.name}
            subtitle={g.computedAt ? t('moat.updated', { date: formatDay(g.computedAt) }) : t('moat.notYet')}
            about={t('moat.source')}
            primary={
              canAsk && g.mentors !== 0 ? (
                <Link
                  to={`/mentors?view=browse&q=${encodeURIComponent(g.name)}`}
                  className={buttonVariants({ variant: 'primary' })}
                >
                  {t('moat.askAlumni')}
                </Link>
              ) : undefined
            }
          />
          <div className="flex flex-wrap gap-2">
            {canPractise && (
              <Link to="/practice" className={buttonVariants({ variant: 'secondary' })}>
                {t('moat.practise', { company: g.name })}
              </Link>
            )}
            {canShare && (
              <Link
                to={`/experiences/new?company=${encodeURIComponent(g.key)}`}
                className={buttonVariants({ variant: 'ghost' })}
              >
                <PenLine className="size-4" aria-hidden /> {t('moat.share')}
              </Link>
            )}
          </div>
          <Figures g={g} />
          <p className="text-callout text-fg-3">{t('moat.small')}</p>
          {canAsk && g.mentors !== 0 && <LazySeniorsAt company={g.name} fallback={null} />}
          <Batches g={g} />
          <Rounds g={g} />
          <section aria-labelledby="company-writeups" className="grid gap-3">
            <h2 id="company-writeups" className="text-headline font-semibold">
              {t('moat.writeUpsTitle')}
            </h2>
            {!g.experiences.length ? (
              <p className="text-body text-fg-2">{t('moat.noWriteUps')}</p>
            ) : (
              <ul className="grid gap-3">
                {g.experiences.map((e) => (
                  <li key={e.id}>
                    <ExperienceCard e={e} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
