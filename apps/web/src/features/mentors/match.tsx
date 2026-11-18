import { lazy, Suspense, useMemo, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Compass, RotateCcw, Send, SlidersHorizontal, X } from 'lucide-react';
import { LOCALE_TAGS, toLocale, type MentorCard, type MentorMatch } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Sheet } from '../../components/ui/dialog';
import { Checkbox, Select } from '../../components/ui/field';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { PersonCard } from '../../components/ui/person-card';
import { Segmented } from '../../components/ui/tab-nav';
import { mentorMatch } from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { useMe } from '../../lib/me';
import { useMedia } from '../../lib/use-media';
import { useUrlOverlay } from '../../lib/use-url-overlay';
import { firstName } from '../../lib/names';
import { MentorStatsLine } from './mentor-stats';
import {
  headlineAdds,
  isDemoMentor,
  levelOf,
  matchSentence,
  reasonText,
  roleLine,
  shownScore,
  stripDemo,
} from './mentor-text';

// The form library and Zod load with the sheet (bundle budget).
const RequestForm = lazy(() => import('./request-form').then((m) => ({ default: m.RequestForm })));

interface Filters {
  company: string;
  role: string;
  branch: string;
  language: string;
  free: boolean;
}
const NONE: Filters = { company: '', role: '', branch: '', language: '', free: false };

const isFree = (m: MentorMatch) =>
  !!m.mentor.stats?.nextFreeSlot || m.reasons.some((r) => r.kind === 'available');

/** The filter options, from the ranked list itself, so none is ever empty. */
function optionsOf(list: MentorMatch[]) {
  const set = (pick: (m: MentorCard) => string[]) =>
    [...new Set(list.flatMap((x) => pick(x.mentor)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    company: set((m) => [stripDemo(m.company)]),
    role: set((m) => [stripDemo(m.jobTitle)]),
    branch: set((m) => (m.branch ? [m.branch] : [])),
    language: set((m) => m.languages),
  };
}

function applyFilters(list: MentorMatch[], f: Filters) {
  return list.filter(
    ({ mentor: m, ...rest }) =>
      (!f.company || stripDemo(m.company) === f.company) &&
      (!f.role || stripDemo(m.jobTitle) === f.role) &&
      (!f.branch || m.branch === f.branch) &&
      (!f.language || m.languages.includes(f.language)) &&
      (!f.free || isFree({ mentor: m, ...rest })),
  );
}

/** A list join in the member's language ("a, b and c"). */
function useListFormat() {
  const { i18n } = useTranslation();
  const fmt = useMemo(
    () => new Intl.ListFormat(LOCALE_TAGS[toLocale(i18n.language)], { type: 'conjunction' }),
    [i18n.language],
  );
  return (items: string[]) => fmt.format(items);
}

function MatchFilters({
  list,
  value,
  onChange,
  count,
}: {
  list: MentorMatch[];
  value: Filters;
  onChange: (f: Filters) => void;
  count: number;
}) {
  const { t } = useTranslation();
  const o = useMemo(() => optionsOf(list), [list]);
  const active = JSON.stringify(value) !== JSON.stringify(NONE);
  const select = (key: 'company' | 'role' | 'branch' | 'language') =>
    o[key].length > 1 && (
      <Select
        key={key}
        size="sm"
        className="w-auto max-w-[12rem]"
        aria-label={t(`mentoring.filters.${key}`)}
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      >
        <option value="">
          {t(`mentoring.filters.${key}`)}: {t('mentoring.filters.any')}
        </option>
        {o[key].map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </Select>
    );
  return (
    <div role="group" aria-label={t('mentoring.filters.label')} className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SlidersHorizontal className="size-4 text-fg-3" aria-hidden />
        {select('company')}
        {select('role')}
        {select('branch')}
        {select('language')}
        <Checkbox id="match-free" checked={value.free} onChange={(free) => onChange({ ...value, free })}>
          {t('mentoring.filters.free')}
        </Checkbox>
      </div>
      <p className="flex items-center gap-2 text-callout text-fg-2" aria-live="polite">
        <span>{t('mentoring.filters.count', { count })}</span>
        {active && (
          <Button variant="tertiary" size="sm" onClick={() => onChange(NONE)}>
            {t('mentoring.filters.clear')}
          </Button>
        )}
      </p>
    </div>
  );
}

/** "Strong match · 82" then the reasons, first (prompt 3, U6): words, a number only when strong. */
function Strength({ match, minor }: { match: MentorMatch; minor: boolean }) {
  const { t } = useTranslation();
  const score = shownScore(match, minor);
  return (
    <section aria-label={t('match.why')} className="grid gap-2">
      <p className="text-headline font-semibold text-brand-ink">
        {t(`match.level.${levelOf(match.score)}`)}
        {score !== null && <span className="tabular font-normal text-fg-2"> · {score}</span>}
      </p>
      {match.reasons.length ? (
        <ul className="grid list-disc gap-1 pl-5 text-callout">
          {match.reasons.map((r) => (
            <li key={r.kind} className="first-letter:uppercase">
              {reasonText(r, t)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-callout text-fg-3">{t('match.noReasons')}</p>
      )}
    </section>
  );
}

function Name({ m, level = 2, link = false }: { m: MentorCard; level?: 2 | 3; link?: boolean }) {
  const { t } = useTranslation();
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <H className="text-headline font-semibold text-pretty">
        {link ? (
          <Link to={`/mentors/${m.userId}`} className="hover:underline">
            {stripDemo(m.name)}
          </Link>
        ) : (
          stripDemo(m.name)
        )}
      </H>
      {isDemoMentor(m) && <Badge>{t('common.demo')}</Badge>}
    </div>
  );
}

function RoleLines({ m }: { m: MentorCard }) {
  const { t } = useTranslation();
  const role = roleLine(m, t);
  return (
    <>
      {role && (
        <p className="flex items-center gap-1 text-callout text-fg-2">
          <span>{role}</span>
          {m.company && m.companyVerified && (
            <BadgeCheck className="size-4 flex-none text-success" aria-label={t('people.companyVerified')} />
          )}
        </p>
      )}
      {(m.branch || m.gradYear) && (
        <p className="text-caption text-fg-3">
          {[m.branch, m.gradYear ? t('people.batch', { year: m.gradYear }) : ''].filter(Boolean).join(' · ')}
        </p>
      )}
    </>
  );
}

function Offers({ m }: { m: MentorCard }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t('mentors.offers')}>
      {m.sessionTypes.map((s) => (
        <li
          key={s.type}
          className="rounded-full bg-surface-2 px-2.5 py-1 text-caption font-semibold text-fg-2"
        >
          {t(`session.type.${s.type}`)}
          {s.durationMin > 0 && (
            <span className="font-normal"> · {t('session.minutes', { n: s.durationMin })}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Desktop: the selected senior beside the list, with one action. */
function MentorPanel({
  match,
  minor,
  onRequest,
}: {
  match: MentorMatch;
  minor: boolean;
  onRequest: () => void;
}) {
  const { t } = useTranslation();
  const m = match.mentor;
  const adds = headlineAdds(m);
  return (
    <Card variant="raised" className="grid content-start gap-4 p-5">
      <div className="flex items-start gap-3">
        <PersonAvatar name={m.name} fileId={m.avatarFileId} size={72} verified />
        <div className="grid min-w-0 gap-0.5">
          <Name m={m} />
          <RoleLines m={m} />
        </div>
      </div>
      <Strength match={match} minor={minor} />
      {adds && <p className="text-body">{adds}</p>}
      {m.stats && <MentorStatsLine stats={m.stats} />}
      <Offers m={m} />
      {!m.open && <p className="text-callout text-fg-2">{t('mentors.fullBody')}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" disabled={!m.open} onClick={onRequest}>
          <Send className="size-5" aria-hidden /> {t('mentoring.request')}
        </Button>
        <Link to={`/mentors/${m.userId}`} className={buttonVariants({ variant: 'tertiary' })}>
          {t('mentors.fullProfile')}
        </Link>
      </div>
    </Card>
  );
}

/** Phones: one senior at a time, Not now or Request (prompt 3, U6: no "Interested"). */
function MatchCard({
  match,
  minor,
  left,
  onNotNow,
  onRequest,
}: {
  match: MentorMatch;
  minor: boolean;
  left: number;
  onNotNow: () => void;
  onRequest: () => void;
}) {
  const { t } = useTranslation();
  const list = useListFormat();
  const m = match.mentor;
  const score = shownScore(match, minor);
  // Arrow keys: ← not now, → request.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') onNotNow();
    if (e.key === 'ArrowRight' && m.open) onRequest();
  };
  return (
    <div
      tabIndex={0}
      onKeyDown={onKey}
      role="region"
      aria-roledescription={t('match.deck')}
      aria-label={t('match.deckLabel', { name: stripDemo(m.name), left })}
      className="mx-auto grid w-full max-w-[460px] min-w-0 gap-4 rounded-[var(--radius-lg)]"
    >
      <Card variant="raised" className="grid gap-3 p-4">
        <div className="flex items-start gap-3">
          <PersonAvatar name={m.name} fileId={m.avatarFileId} size={56} verified />
          <div className="grid min-w-0 gap-0.5">
            <Name m={m} link />
            <RoleLines m={m} />
          </div>
        </div>
        <p className="text-callout">
          {matchSentence(match, t, list)}
          {score !== null && <span className="tabular text-fg-2"> · {score}</span>}
        </p>
        {m.stats && <MentorStatsLine stats={m.stats} />}
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <Button
          size="lg"
          onClick={onNotNow}
          aria-label={t('mentoring.notNowFor', { name: stripDemo(m.name) })}
        >
          <X className="size-5" aria-hidden /> {t('mentoring.notNow')}
        </Button>
        <Button
          size="lg"
          variant="primary"
          disabled={!m.open}
          onClick={onRequest}
          aria-label={t('mentoring.requestFor', { name: stripDemo(m.name) })}
        >
          <Send className="size-5" aria-hidden /> {t('mentoring.request')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Alumni Match (prompt 3, U6). Wide screens: the ranked list with filters, and the selected senior
 * beside it. Phones: one card at a time (Not now, Request) or the same list. Request opens the
 * request sheet in place; the ranking is the API's, filters only narrow it.
 */
export function MatchView({ onPrefs }: { onPrefs: () => void }) {
  const { t } = useTranslation();
  const list = useListFormat();
  const { data: me } = useMe();
  const minor = !!me?.minor;
  const wide = useMedia('(min-width: 1024px)');
  const [params, setParams] = useSearchParams();
  const show = params.get('show') === 'list' ? 'list' : 'card';
  const q = useQuery({ ...mentorMatch(), ...SCREEN });
  const all = q.data ?? [];
  const [filters, setFilters] = useState<Filters>(NONE);
  const [passed, setPassed] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [asking, setAsking] = useState<MentorCard | null>(null);
  const sheet = useUrlOverlay('ask');
  const filtered = applyFilters(all, filters);
  const ask = (m: MentorCard) => {
    setAsking(m);
    sheet.open('request');
  };

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isSuccess && !all.length)
    return (
      <EmptyState icon={<Compass className="size-6" />} title={t('match.empty')}>
        {t('match.emptyBody')}
      </EmptyState>
    );

  const prefs = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-callout text-fg-2">{t('match.intro')}</p>
      <Button size="sm" onClick={onPrefs}>
        <SlidersHorizontal className="size-4" aria-hidden /> {t('match.prefs')}
      </Button>
    </div>
  );
  const requestSheet = (
    <Sheet
      open={sheet.value === 'request' && !!asking}
      onOpenChange={(o) => !o && sheet.close()}
      title={asking ? t('request.title', { name: firstName(stripDemo(asking.name)) }) : ''}
      history={false}
    >
      {asking && (
        <Suspense fallback={<Skeleton className="h-96" />}>
          <RequestForm mentor={asking} />
        </Suspense>
      )}
    </Sheet>
  );
  const filterBar = <MatchFilters list={all} value={filters} onChange={setFilters} count={filtered.length} />;

  if (wide) {
    const current = filtered.find((x) => x.mentor.userId === selected) ?? filtered[0];
    return (
      <div className="grid gap-4">
        {prefs}
        {filterBar}
        {filtered.length ? (
          <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-start gap-5">
            <ListSection>
              {filtered.map((x) => (
                <ListRow
                  key={x.mentor.userId}
                  selected={x.mentor.userId === current?.mentor.userId}
                  onClick={() => setSelected(x.mentor.userId)}
                  leading={<PersonAvatar name={x.mentor.name} fileId={x.mentor.avatarFileId} size={44} />}
                  title={
                    <span className="flex flex-wrap items-center gap-1.5">
                      {stripDemo(x.mentor.name)}
                      {isDemoMentor(x.mentor) && <Badge>{t('common.demo')}</Badge>}
                    </span>
                  }
                  meta={
                    <>
                      <span className="block">{roleLine(x.mentor, t)}</span>
                      <span className="block text-fg">{matchSentence(x, t, list)}</span>
                    </>
                  }
                />
              ))}
            </ListSection>
            <div className="sticky top-5">
              {current ? (
                <MentorPanel match={current} minor={minor} onRequest={() => ask(current.mentor)} />
              ) : (
                <p className="text-callout text-fg-2">{t('mentoring.pick')}</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-callout text-fg-2">{t('mentoring.filters.none')}</p>
        )}
        {requestSheet}
      </div>
    );
  }

  const deck = filtered.filter((x) => !passed.includes(x.mentor.userId));
  const top = deck[0];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex items-center gap-2">
        <Segmented
          className="min-w-0 flex-1"
          label={t('mentoring.viewAs')}
          value={show}
          options={[
            ['card', t('mentoring.card')],
            ['list', t('mentoring.list')],
          ]}
          onChange={(v) =>
            setParams(
              (p) => {
                const n = new URLSearchParams(p);
                if (v === 'list') n.set('show', 'list');
                else n.delete('show');
                return n;
              },
              { replace: true },
            )
          }
        />
        <Button size="sm" onClick={onPrefs}>
          <SlidersHorizontal className="size-4" aria-hidden /> {t('match.prefs')}
        </Button>
      </div>
      {/* On a phone the card speaks for itself; the list says what it is. */}
      {show === 'list' && <p className="text-callout text-fg-2">{t('match.intro')}</p>}
      {show === 'list' ? (
        <>
          {filterBar}
          <ul className="grid gap-3">
            {filtered.map((x) => (
              <li key={x.mentor.userId}>
                <PersonCard
                  layout="row"
                  name={stripDemo(x.mentor.name)}
                  photoId={x.mentor.avatarFileId}
                  role={roleLine(x.mentor, t) || undefined}
                  reason={matchSentence(x, t, list)}
                  demo={isDemoMentor(x.mentor)}
                  demoLabel={t('common.demo')}
                  verified
                  to={`/mentors/${x.mentor.userId}`}
                  action={
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!x.mentor.open}
                      onClick={() => ask(x.mentor)}
                    >
                      {t('mentoring.request')}
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
          {!filtered.length && <p className="text-callout text-fg-2">{t('mentoring.filters.none')}</p>}
        </>
      ) : top ? (
        <MatchCard
          key={top.mentor.userId}
          match={top}
          minor={minor}
          left={deck.length}
          onNotNow={() => setPassed((p) => [...p, top.mentor.userId])}
          onRequest={() => ask(top.mentor)}
        />
      ) : (
        <EmptyState
          icon={<Compass className="size-6" />}
          title={t('match.done')}
          action={
            <Button onClick={() => setPassed([])}>
              <RotateCcw className="size-4" aria-hidden /> {t('match.again')}
            </Button>
          }
        >
          {t('match.emptyBody')}
        </EmptyState>
      )}
      {requestSheet}
    </div>
  );
}
