import { useDeferredValue, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, useMotionValue, useTransform, animate, type PanInfo } from 'motion/react';
import { useReducedMotionPref } from '../../lib/preferences';
import { toast } from 'sonner';
import { Compass, Heart, RotateCcw, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { SESSION_TYPES, type MentorCard, type MentorMatch, type MatchReason } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Dialog } from '../../components/ui/dialog';
import { Field, Input, Select } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { Segmented } from '../../components/ui/tab-nav';
import { TagInput } from '../../components/ui/tag-input';
import { api } from '../../lib/api';

export function MentorTile({ m }: { m: MentorCard }) {
  const { t } = useTranslation();
  return (
    <Link to={`/mentors/${m.userId}`} className="block h-full rounded-[var(--radius-md)]">
      <Card className="grid h-full gap-3 p-4 transition-colors hover:border-line-strong">
        <div className="flex items-start gap-3">
          <PersonAvatar name={m.name} fileId={m.avatarFileId} verified />
          <div className="min-w-0 flex-1">
            <b className="block truncate">{m.name}</b>
            {m.headline && <p className="line-clamp-2 text-sm text-fg-2">{m.headline}</p>}
          </div>
          {!m.open && <Badge tone="warning">{t('mentors.full')}</Badge>}
        </div>
        <div className="flex flex-wrap gap-1">
          {m.company && <Badge tone={m.companyVerified ? 'success' : 'neutral'}>{m.company}</Badge>}
          {m.branch && (
            <Badge>{[m.branch, m.gradYear ? `’${String(m.gradYear).slice(2)}` : ''].join(' ')}</Badge>
          )}
          {m.topics.slice(0, 3).map((x) => (
            <Badge key={x} tone="brand">
              {x}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-fg-3">
          {m.sessionTypes.map((s) => t(`session.type.${s.type}`)).join(' · ')}
        </p>
      </Card>
    </Link>
  );
}

function ReasonList({ reasons }: { reasons: MatchReason[] }) {
  const { t } = useTranslation();
  if (!reasons.length) return <p className="text-sm text-fg-3">{t('match.noReasons')}</p>;
  return (
    <ul className="grid gap-1.5 text-sm">
      {reasons.map((r) => (
        <li key={r.kind} className="flex items-start gap-2">
          <Sparkles className="mt-0.5 size-4 flex-none text-accent-ink" aria-hidden />
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
  const m = match.mentor;
  const settle = (dir: -1 | 0 | 1, done?: () => void) => {
    if (reduce || dir === 0) {
      void animate(x, 0, { duration: reduce ? 0 : 0.2 });
      done?.();
      return;
    }
    void animate(x, dir * 480, { duration: 0.22 }).then(() => {
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
      drag={reduce ? false : 'x'}
      dragSnapToOrigin
      onDragEnd={onDragEnd}
      className="touch-pan-y"
    >
      <Card className="relative grid gap-4 overflow-hidden p-5 pt-14">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-20 bg-[radial-gradient(60%_120%_at_15%_0%,color-mix(in_srgb,var(--brand)_55%,transparent),transparent_70%),radial-gradient(60%_140%_at_90%_10%,color-mix(in_srgb,var(--accent)_45%,transparent),transparent_70%)]"
        />
        <div className="relative flex items-end gap-3">
          <PersonAvatar name={m.name} fileId={m.avatarFileId} size={72} verified />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-bold">{m.name}</h2>
            {m.headline && <p className="line-clamp-2 text-sm text-fg-2">{m.headline}</p>}
          </div>
          <div
            className="grid size-16 flex-none place-items-center rounded-full border-4 border-[color-mix(in_srgb,var(--brand)_60%,transparent)] font-display text-lg font-bold"
            aria-label={t('match.score', { score: match.score })}
          >
            {match.score}
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
  const q = useQuery({ queryKey: ['match'], queryFn: () => api.get<MentorMatch[]>('/mentors/match') });
  const deck = (q.data ?? []).filter((m) => !passed.includes(m.mentor.userId));
  const top = deck[0];
  const pass = () => top && setPassed((p) => [...p, top.mentor.userId]);
  const pick = () => top && void navigate(`/mentors/${top.mentor.userId}`);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') pass();
    if (e.key === 'ArrowRight') pick();
  };
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-2">{t('match.intro')}</p>
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
          className="mx-auto grid w-full max-w-[460px] gap-4 rounded-[var(--radius-lg)]"
        >
          <MatchCard key={top.mentor.userId} match={top} onPass={pass} onPick={pick} />
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
          <p className="text-center text-xs text-fg-3">{t('match.keys')}</p>
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
    queryKey: ['mentors', dq, type],
    queryFn: () => api.get<MentorCard[]>(`/mentors?${params}`),
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
            <Select id={id} value={type} onChange={(e) => setType(e.target.value)} className="min-h-[50px]">
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[clamp(26px,4vw,34px)] font-bold">{t('mentors.title')}</h1>
        <Link to="/mentorship" className={buttonVariants({ size: 'sm' })}>
          {t('nav.requests')}
        </Link>
      </div>
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
