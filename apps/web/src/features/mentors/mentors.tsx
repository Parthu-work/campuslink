import { useDeferredValue, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LazyMotion,
  m as motion,
  motionFeatures,
  useAnimationControls,
  useMotionValue,
  useTransform,
  type PanInfo,
} from '../../lib/motion';
import { useReducedMotionPref } from '../../lib/preferences';
import { toast } from '../../lib/toast';
import { BadgeCheck, Compass, Heart, RotateCcw, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { SESSION_TYPES, type MentorCard, type MentorMatch, type MatchReason } from '@campuslink/shared';
import { IntentLink } from '../../components/ui/intent-link';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Dialog } from '../../components/ui/dialog';
import { Field, Input, Select } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { ProgressRing } from '../../components/ui/progress';
import { Segmented } from '../../components/ui/tab-nav';
import { TagInput } from '../../components/ui/tag-input';
import { api } from '../../lib/api';
import { mentorMatch } from '../../lib/queries';
import { coverOf } from '../../lib/accent';
import { SCREEN } from '../../lib/query-client';

/**
 * A mentor in a list (§8.4): a large face, what they do and where, their batch, a few topics and
 * the sessions they offer. Reply time and next free slot are not in the API, so they are not shown.
 */
export function MentorTile({ m }: { m: MentorCard }) {
  const { t } = useTranslation();
  return (
    <IntentLink to={`/mentors/${m.userId}`} className="block h-full rounded-[var(--radius-lg)]">
      <Card variant="interactive" className="grid h-full content-start gap-3 overflow-hidden">
        <div aria-hidden className="h-14" style={{ background: coverOf(m.name) }} />
        <div className="-mt-10 grid gap-3 px-4 pb-4">
          <div className="flex items-end justify-between gap-2">
            {/* Morphs into the mentor page's header (view transition). */}
            <span
              className="flex-none rounded-full ring-4 ring-surface-1"
              style={{ viewTransitionName: `mentor-${m.userId}` }}
            >
              <PersonAvatar name={m.name} fileId={m.avatarFileId} size={64} verified />
            </span>
            {!m.open && <Badge tone="warning">{t('mentors.full')}</Badge>}
          </div>
          <div className="min-w-0">
            <b className="block truncate text-title">{m.name}</b>
            {(m.jobTitle || m.company) && (
              <p className="flex min-w-0 items-center gap-1 text-meta text-fg-2">
                <span className="truncate">{[m.jobTitle, m.company].filter(Boolean).join(' · ')}</span>
                {m.company && m.companyVerified && (
                  <BadgeCheck
                    className="size-4 flex-none text-success"
                    aria-label={t('people.companyVerified')}
                  />
                )}
              </p>
            )}
            {(m.branch || m.gradYear) && (
              <p className="text-caption text-fg-3">
                {[m.branch, m.gradYear ? t('people.batch', { year: m.gradYear }) : '']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
          {m.headline && <p className="line-clamp-2 text-meta text-fg-2">{m.headline}</p>}
          {m.topics.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {m.topics.slice(0, 3).map((x) => (
                <Badge key={x} tone="brand">
                  {x}
                </Badge>
              ))}
            </div>
          )}
          <ul className="flex flex-wrap gap-1.5 border-t border-line pt-3" aria-label={t('mentors.offers')}>
            {m.sessionTypes.map((s) => (
              <li
                key={s.type}
                className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-caption font-semibold text-fg-2"
              >
                {t(`session.type.${s.type}`)}
                {s.durationMin > 0 && (
                  <span className="font-normal">· {t('session.minutes', { n: s.durationMin })}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </IntentLink>
  );
}

/** Plain-language strength of an Alumni Match score (0–100). */
const levelOf = (score: number) => (score >= 60 ? 'strong' : score >= 30 ? 'good' : 'some');

function ReasonList({ reasons }: { reasons: MatchReason[] }) {
  const { t } = useTranslation();
  if (!reasons.length) return <p className="text-meta text-fg-3">{t('match.noReasons')}</p>;
  return (
    <ul className="grid gap-1.5 text-meta">
      {reasons.map((r) => (
        <li key={r.kind} className="flex items-start gap-2">
          <Sparkles className="mt-0.5 size-4 flex-none text-brand-ink" aria-hidden />
          <span>
            {r.kind === 'branch' || r.kind === 'company'
              ? t(`match.reason.${r.kind}`, { value: r.value })
              : r.kind === 'available'
                ? t('match.reason.available')
                : t(`match.reason.${r.kind}`, { values: r.values.join(', ') })}
          </span>
        </li>
      ))}
    </ul>
  );
}

function MatchCard({
  match,
  onPass,
  onPick,
}: {
  match: MentorMatch;
  onPass: () => void;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotionPref();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], [-10, 10]);
  const opacity = useTransform(x, [-260, 0, 260], [0.4, 1, 0.4]);
  // Animating `x` through the controls moves the same motion value the style reads.
  const controls = useAnimationControls();
  const m = match.mentor;
  const settle = (dir: -1 | 0 | 1, done?: () => void) => {
    if (reduce || dir === 0) {
      void controls.start({ x: 0, transition: { duration: reduce ? 0 : 0.2 } });
      done?.();
      return;
    }
    void controls.start({ x: dir * 480, transition: { duration: 0.22 } }).then(() => {
      x.set(0);
      done?.();
    });
  };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > 120) settle(1, onPick);
    else if (info.offset.x < -120) settle(-1, onPass);
    else settle(0);
  };
  return (
    <motion.div
      style={{ x, rotate, opacity }}
      animate={controls}
      drag={reduce ? false : 'x'}
      dragSnapToOrigin
      onDragEnd={onDragEnd}
      className="touch-pan-y"
    >
      <Card variant="raised" className="relative grid gap-4 overflow-hidden p-5 pt-14">
        <div aria-hidden className="absolute inset-x-0 top-0 h-20" style={{ background: coverOf(m.name) }} />
        <div className="relative flex items-end gap-3">
          <PersonAvatar name={m.name} fileId={m.avatarFileId} size={72} verified />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-title font-bold">{m.name}</h2>
            {(m.jobTitle || m.company) && (
              <p className="truncate text-meta text-fg-2">
                {[m.jobTitle, m.company].filter(Boolean).join(' · ')}
              </p>
            )}
            {m.headline && <p className="line-clamp-2 text-meta text-fg-2">{m.headline}</p>}
          </div>
          {/* A ring and a word, not a bare number (MC-3: "30" read like a bad grade). */}
          <div className="grid flex-none justify-items-center gap-1">
            <ProgressRing
              value={match.score}
              max={100}
              size={60}
              tone="aurora"
              label={t('match.score', { score: match.score })}
              valueText={t(`match.level.${levelOf(match.score)}`)}
            >
              <span className="text-meta font-bold tabular-nums">{match.score}</span>
            </ProgressRing>
            <span className="text-caption font-semibold text-fg-2" aria-hidden>
              {t(`match.level.${levelOf(match.score)}`)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {m.company && <Badge tone={m.companyVerified ? 'success' : 'neutral'}>{m.company}</Badge>}
          {m.branch && <Badge>{m.branch}</Badge>}
          {m.topics.map((x) => (
            <Badge key={x} tone="brand">
              {x}
            </Badge>
          ))}
        </div>
        <section aria-label={t('match.why')} className="grid gap-2">
          <h3 className="eyebrow">{t('match.why')}</h3>
          <ReasonList reasons={match.reasons} />
        </section>
      </Card>
    </motion.div>
  );
}

function PrefsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const prefs = useQuery({
    queryKey: ['match-prefs'],
    queryFn: () => api.get<{ goals: string[]; targetCompanies: string[] }>('/me/match-preferences'),
    enabled: open,
  });
  const [draft, setDraft] = useState<{ goals: string[]; targetCompanies: string[] } | null>(null);
  const value = draft ?? prefs.data ?? { goals: [], targetCompanies: [] };
  const save = useMutation({
    mutationFn: () => api.put('/me/match-preferences', value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['match'] });
      void qc.invalidateQueries({ queryKey: ['match-prefs'] });
      setDraft(null);
      onOpenChange(false);
      toast.success(t('common.saved'));
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('match.prefsTitle')}
      description={t('match.prefsBody')}
    >
      <div className="grid gap-4">
        <TagInput
          label={t('match.goals')}
          hint={t('match.goalsHint')}
          value={value.goals}
          max={10}
          onChange={(goals) => setDraft({ ...value, goals })}
        />
        <TagInput
          label={t('match.companies')}
          hint={t('match.companiesHint')}
          value={value.targetCompanies}
          max={10}
          onChange={(targetCompanies) => setDraft({ ...value, targetCompanies })}
        />
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function MatchView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [passed, setPassed] = useState<string[]>([]);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const q = useQuery({ ...mentorMatch(), ...SCREEN });
  const deck = (q.data ?? []).filter((m) => !passed.includes(m.mentor.userId));
  const top = deck[0];
  const pass = () => top && setPassed((p) => [...p, top.mentor.userId]);
  const pick = () => top && void navigate(`/mentors/${top.mentor.userId}`);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') pass();
    if (e.key === 'ArrowRight') pick();
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta text-fg-2">{t('match.intro')}</p>
        <Button size="sm" onClick={() => setPrefsOpen(true)}>
          <SlidersHorizontal className="size-4" aria-hidden /> {t('match.prefs')}
        </Button>
      </div>
      <PrefsDialog open={prefsOpen} onOpenChange={setPrefsOpen} />
      {q.isLoading && <Skeleton className="h-96" />}
      {q.isSuccess && !top && (
        <EmptyState
          icon={<Compass className="size-6" />}
          title={q.data.length ? t('match.done') : t('match.empty')}
          action={
            passed.length ? (
              <Button onClick={() => setPassed([])}>
                <RotateCcw className="size-4" aria-hidden /> {t('match.again')}
              </Button>
            ) : undefined
          }
        >
          {t('match.emptyBody')}
        </EmptyState>
      )}
      {top && (
        // Arrow keys mirror the swipe: ← pass, → open the mentor.
        <div
          tabIndex={0}
          onKeyDown={onKey}
          role="region"
          aria-roledescription={t('match.deck')}
          aria-label={t('match.deckLabel', { name: top.mentor.name, left: deck.length })}
          className="mx-auto grid w-full max-w-[460px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4 rounded-[var(--radius-lg)]"
        >
          <LazyMotion features={motionFeatures} strict>
            <MatchCard key={top.mentor.userId} match={top} onPass={pass} onPick={pick} />
          </LazyMotion>
          <div className="flex justify-center gap-4">
            <Button size="lg" onClick={pass} aria-label={t('match.pass', { name: top.mentor.name })}>
              <X className="size-5" aria-hidden /> {t('match.passShort')}
            </Button>
            <Button
              size="lg"
              variant="primary"
              onClick={pick}
              aria-label={t('match.view', { name: top.mentor.name })}
            >
              <Heart className="size-5" aria-hidden /> {t('match.viewShort')}
            </Button>
          </div>
          <p className="text-center text-caption text-fg-3">{t('match.keys')}</p>
        </div>
      )}
    </div>
  );
}

function BrowseView() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const dq = useDeferredValue(q.trim());
  const params = new URLSearchParams({ ...(dq ? { q: dq } : {}), ...(type ? { sessionType: type } : {}) });
  const list = useQuery({
    ...SCREEN,
    queryKey: ['mentors', dq, type],
    queryFn: () => api.get<MentorCard[]>(`/mentors?${params}`),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <label className="relative">
          <span className="sr-only">{t('mentors.search')}</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-fg-3"
            aria-hidden
          />
          <Input
            type="search"
            enterKeyHint="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('mentors.search')}
            className="pl-11"
          />
        </label>
        <Field label={<span className="sr-only">{t('mentors.sessionType')}</span>}>
          {({ id }) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">{t('mentors.anyType')}</option>
              {SESSION_TYPES.map((s) => (
                <option key={s} value={s}>
                  {t(`session.type.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {list.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      )}
      {list.isSuccess && !list.data.length && (
        <EmptyState icon={<Compass className="size-6" />} title={t('mentors.empty')}>
          {t('mentors.emptyBody')}
        </EmptyState>
      )}
      <ul className="grid gap-3 sm:grid-cols-2" aria-live="polite">
        {list.data?.map((m) => (
          <li key={m.userId}>
            <MentorTile m={m} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MentorsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'browse' ? 'browse' : 'match';
  return (
    <>
      <PageHeader
        title={t('mentors.title')}
        actions={
          <>
            <Link to="/mentorship" className={buttonVariants({ size: 'sm' })}>
              {t('nav.requests')}
            </Link>
          </>
        }
      />
      <Segmented
        label={t('mentors.title')}
        value={view}
        options={[
          ['match', t('mentors.match')],
          ['browse', t('mentors.browse')],
        ]}
        onChange={(v) => setParams(v === 'browse' ? { view: 'browse' } : {}, { replace: true })}
      />
      {view === 'match' ? <MatchView /> : <BrowseView />}
    </>
  );
}
