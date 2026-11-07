import { useDeferredValue, useState } from 'react';
import { Link, useParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, MessageSquareQuote, PenLine, Search } from 'lucide-react';
import type { CompanyGraphView, Count } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { BackLink } from '../../components/ui/back-link';
import { buttonVariants } from '../../components/ui/button-variants';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input } from '../../components/ui/field';
import { Illustration } from '../../components/ui/illustration';
import { IntentLink } from '../../components/ui/intent-link';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { Table, Td, TdNum, Th, THead } from '../../components/ui/table';
import { formatDay } from '../../lib/format';
import { useCan } from '../../lib/me';
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

/** Companies from the Placement Graph (prompt 2, G10): where seniors went and who is there. */
export function CompaniesPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const list = useQuery({ ...SCREEN, ...q.companies(term), placeholderData: keepPreviousData });
  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-5">
      <PageHeader
        icon={<Building2 />}
        title={t('nav.companies')}
        intro={t('moat.intro')}
        actions={<ShareActions />}
      />
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
          <p className="text-meta text-fg-3">
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
              {list.data.items.map((c) => (
                <li key={c.key}>
                  <Card variant="interactive" className="relative grid h-full gap-1.5 p-4">
                    <IntentLink
                      to={`/companies/${encodeURIComponent(c.key)}`}
                      className="font-semibold after:absolute after:inset-0"
                    >
                      {c.name}
                    </IntentLink>
                    <p className="flex flex-wrap gap-x-3 gap-y-1 text-meta text-fg-2">
                      {c.offers !== 0 && <span>{t('moat.placed', { n: shown(c.offers) })}</span>}
                      {!!c.batches.length && (
                        <span>{t('moat.batches', { years: c.batches.join(', ') })}</span>
                      )}
                      {c.alumni !== 0 && <span>{t('moat.alumni', { n: shown(c.alumni) })}</span>}
                    </p>
                    {!!c.experiences && (
                      <p className="flex items-center gap-1.5 text-meta text-brand-ink">
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
      <StatCard label={t('moat.stat.placed')} value={shown(g.offers)} />
      {g.yourBranch && (
        <StatCard
          label={t('moat.stat.yourBranch', { branch: g.yourBranch.branch })}
          value={shown(g.yourBranch.offers)}
        />
      )}
      <StatCard label={t('moat.stat.alumni')} value={shown(g.alumni)} />
      <StatCard label={t('moat.stat.mentors')} value={shown(g.mentors)} />
      <StatCard label={t('moat.stat.drives')} value={shown(g.drives)} />
      <StatCard label={t('moat.stat.sessions')} value={shown(g.sessions)} />
    </StatGrid>
  );
}

function Batches({ g }: { g: CompanyGraphView }) {
  const { t } = useTranslation();
  if (!g.batches.length) return null;
  return (
    <section aria-labelledby="company-batches" className="grid gap-2">
      <h2 id="company-batches" className="text-title font-semibold">
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
        <p className="flex flex-wrap items-center gap-2 text-meta text-fg-2">
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
          <h2 id="company-rounds" className="text-title font-semibold">
            {t('moat.rounds')}
          </h2>
          <ol className="grid gap-2 sm:grid-cols-2">
            {g.rounds.map((r) => (
              <li key={r.kind}>
                <Card className="grid gap-1 p-3">
                  <p className="font-semibold">{t(`placements.roundKind.${r.kind}`)}</p>
                  <p className="text-meta text-fg-2">
                    {t('moat.sat', { n: shown(r.appeared) })} ·{' '}
                    {r.passRate === null ? t('moat.rateHidden') : t('moat.cleared', { pct: r.passRate })}
                  </p>
                </Card>
              </li>
            ))}
          </ol>
        </>
      )}
      {g.referrals.referred !== 0 && (
        <Card className="grid gap-1 p-3">
          <p className="font-semibold">{t('moat.referrals')}</p>
          <p className="text-meta text-fg-2">
            {t('moat.referralLine', {
              referred: shown(g.referrals.referred),
              converted: shown(g.referrals.converted),
            })}
            {g.referrals.rate !== null && <> {t('moat.referralRate', { pct: g.referrals.rate })}</>}
          </p>
        </Card>
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
            icon={<Building2 />}
            title={g.name}
            intro={`${t('moat.source')} ${g.computedAt ? t('moat.updated', { date: formatDay(g.computedAt) }) : t('moat.notYet')}`}
          />
          <div className="flex flex-wrap gap-2">
            {canAsk && (
              <Link
                to={`/mentors?view=browse&q=${encodeURIComponent(g.name)}`}
                className={buttonVariants({ variant: 'primary' })}
              >
                {t('moat.askAlumni')}
              </Link>
            )}
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
          <p className="text-meta text-fg-3">{t('moat.small')}</p>
          <Batches g={g} />
          <Rounds g={g} />
          <section aria-labelledby="company-writeups" className="grid gap-3">
            <h2 id="company-writeups" className="text-title font-semibold">
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
