import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HeartHandshake, Plus, Star, Trash2 } from 'lucide-react';
import {
  MENTEE_AUDIENCES,
  SESSION_DURATIONS,
  type AvailabilityBody,
  type FeedbackView,
  type ImpactView,
  type MentorSettingsBody,
  type MentorSettingsView,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Field, Input, Select } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { formatRelative } from '../../lib/format';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const TIMES = Array.from(
  { length: 97 },
  (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
);
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const errorToast = (t: (k: string) => string) => (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'));

function ImpactCard() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['impact'], queryFn: () => api.get<ImpactView>('/me/mentor/impact') });
  if (q.isLoading) return <Skeleton className="h-44" />;
  if (!q.data) return null;
  const i = q.data;
  const tiles = [
    [t('mentor.sessionsMonth'), i.sessionsThisMonth],
    [t('mentor.sessionsTotal'), i.sessionsTotal],
    [t('mentor.menteesTotal'), i.menteesTotal],
    [t('mentor.rating'), i.averageRating === null ? '—' : `${i.averageRating} ★`],
  ] as const;
  return (
    <Card className="relative grid gap-4 overflow-hidden p-5">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(70%_100%_at_0%_0%,color-mix(in_srgb,var(--brand)_30%,transparent),transparent_70%),radial-gradient(60%_100%_at_100%_100%,color-mix(in_srgb,var(--accent)_22%,transparent),transparent_70%)]"
      />
      <div className="relative flex items-center gap-4">
        <span
          className="grid size-14 flex-none place-items-center rounded-2xl bg-surface-2 text-accent-ink"
          aria-hidden
        >
          <HeartHandshake className="size-7" />
        </span>
        <div>
          <p className="eyebrow">{t('mentor.impact')}</p>
          <h2 className="font-display text-2xl leading-tight font-bold">
            {t('mentor.helped', { count: i.helpedThisMonth })}
          </h2>
        </div>
      </div>
      <dl className="relative grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-md)] bg-surface-2 p-3">
            <dt className="text-xs text-fg-3">{label}</dt>
            <dd className="font-display text-xl font-bold">{value}</dd>
          </div>
        ))}
      </dl>
      {i.pendingRequests > 0 && (
        <Link
          to="/mentorship?box=received"
          className="relative justify-self-start text-sm font-semibold text-brand-ink hover:underline"
        >
          {t('mentor.pending', { count: i.pendingRequests })}
        </Link>
      )}
    </Card>
  );
}

function SettingsForm({ initial }: { initial: MentorSettingsView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { availability: _a, ...base } = initial;
  const [s, setS] = useState<MentorSettingsBody>(base);
  const save = useMutation({
    mutationFn: (body: MentorSettingsBody) => api.put<MentorSettingsView>('/me/mentor', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mentor-settings'] });
      void qc.invalidateQueries({ queryKey: ['impact'] });
      toast.success(t('common.saved'));
    },
    onError: errorToast(t),
  });
  const set = (patch: Partial<MentorSettingsBody>) => setS((x) => ({ ...x, ...patch }));
  return (
    <Card className="grid gap-5 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{t('mentor.accepting')}</h2>
          <p className="text-sm text-fg-2">
            {s.accepting ? t('mentor.acceptingOn') : t('mentor.acceptingOff')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={s.accepting}
          aria-label={t('mentor.accepting')}
          onClick={() => {
            const next = { ...s, accepting: !s.accepting };
            setS(next);
            save.mutate(next);
          }}
          className="group relative h-8 w-14 flex-none rounded-full border border-line-strong bg-surface-3 transition-colors aria-checked:bg-brand"
        >
          <span
            aria-hidden
            className="absolute top-1 left-1 size-6 rounded-full bg-white shadow transition-transform duration-[var(--dur-fast)] group-aria-checked:translate-x-6"
          />
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('mentor.weeklyCap')} hint={t('mentor.weeklyCapHint')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              min={1}
              max={30}
              value={s.weeklyCap}
              onChange={(e) => set({ weeklyCap: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
            />
          )}
        </Field>
        <Field label={t('mentor.audience')}>
          {({ id }) => (
            <Select
              id={id}
              value={s.audience}
              onChange={(e) => set({ audience: e.target.value as MentorSettingsBody['audience'] })}
            >
              {MENTEE_AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {t(`mentor.audiences.${a}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('mentor.notice')}>
          {({ id }) => (
            <Select
              id={id}
              value={s.minNoticeHours}
              onChange={(e) => set({ minNoticeHours: Number(e.target.value) })}
            >
              {[1, 2, 4, 6, 12, 24, 48, 72].map((h) => (
                <option key={h} value={h}>
                  {t('mentor.hours', { count: h })}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('mentor.horizon')}>
          {({ id }) => (
            <Select
              id={id}
              value={s.horizonDays}
              onChange={(e) => set({ horizonDays: Number(e.target.value) })}
            >
              {[7, 14, 30, 60].map((d) => (
                <option key={d} value={d}>
                  {t('mentor.days', { count: d })}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('mentor.buffer')}>
          {({ id }) => (
            <Select
              id={id}
              value={s.bufferMin}
              onChange={(e) => set({ bufferMin: Number(e.target.value) as MentorSettingsBody['bufferMin'] })}
            >
              {[0, 15, 30].map((m) => (
                <option key={m} value={m}>
                  {m ? t('session.minutes', { n: m }) : t('mentor.noBuffer')}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-[13px] font-semibold">{t('mentor.sessionTypes')}</legend>
        {s.sessionTypes.map((st, i) => (
          <div
            key={st.type}
            className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-line p-3"
          >
            <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={st.enabled}
                onChange={(e) =>
                  set({
                    sessionTypes: s.sessionTypes.map((x, j) =>
                      j === i ? { ...x, enabled: e.target.checked } : x,
                    ),
                  })
                }
                className="size-5 accent-[var(--brand)]"
              />
              <span className="font-semibold">{t(`session.type.${st.type}`)}</span>
            </label>
            {st.type !== 'quick_chat' && (
              <label className="flex items-center gap-2 text-sm">
                <span className="sr-only">
                  {t('mentor.duration', { type: t(`session.type.${st.type}`) })}
                </span>
                <Select
                  value={st.durationMin}
                  onChange={(e) =>
                    set({
                      sessionTypes: s.sessionTypes.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              durationMin: Number(e.target.value) as (typeof SESSION_DURATIONS)[number],
                            }
                          : x,
                      ),
                    })
                  }
                  className="min-h-10 w-32"
                >
                  {SESSION_DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {t('session.minutes', { n: d })}
                    </option>
                  ))}
                </Select>
              </label>
            )}
          </div>
        ))}
      </fieldset>
      <Button
        variant="primary"
        className="justify-self-start"
        loading={save.isPending}
        onClick={() => save.mutate(s)}
      >
        {t('common.save')}
      </Button>
    </Card>
  );
}

function WindowRow({
  w,
  onChange,
  onRemove,
  label,
}: {
  w: { start: string; end: string };
  onChange: (w: { start: string; end: string }) => void;
  onRemove: () => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label={t('mentor.from', { day: label })}
        value={w.start}
        onChange={(e) => onChange({ ...w, start: e.target.value })}
        className="min-h-11 min-w-0 flex-1 sm:w-28 sm:flex-none"
      >
        {TIMES.slice(0, -1).map((x) => (
          <option key={x}>{x}</option>
        ))}
      </Select>
      <span aria-hidden>–</span>
      <Select
        aria-label={t('mentor.to', { day: label })}
        value={w.end}
        onChange={(e) => onChange({ ...w, end: e.target.value })}
        className="min-h-11 min-w-0 flex-1 sm:w-28 sm:flex-none"
      >
        {TIMES.slice(1).map((x) => (
          <option key={x} value={x}>
            {x === '24:00' ? t('mentor.midnight') : x}
          </option>
        ))}
      </Select>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('mentor.removeRange', { day: label })}
        onClick={onRemove}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

function AvailabilityEditor({ initial }: { initial: AvailabilityBody }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [a, setA] = useState<AvailabilityBody>(initial);
  const save = useMutation({
    mutationFn: () => api.put('/me/mentor/availability', a),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mentor-settings'] });
      toast.success(t('common.saved'));
    },
    onError: errorToast(t),
  });
  const zones = Intl.supportedValuesOf('timeZone');
  const dayName = (d: number) =>
    new Intl.DateTimeFormat(i18n.language === 'te' ? 'te-IN' : 'en-IN', { weekday: 'long' }).format(
      new Date(Date.UTC(2026, 0, 4 + d)),
    );
  const rule = (d: number) => a.weekly.find((r) => r.day === d);
  const setDay = (d: number, windows: { start: string; end: string }[]) =>
    setA((x) => ({
      ...x,
      weekly: windows.length
        ? [...x.weekly.filter((r) => r.day !== d), { day: d, windows }]
        : x.weekly.filter((r) => r.day !== d),
    }));
  const invalid = a.weekly.some((r) => r.windows.some((w) => toMin(w.start) >= toMin(w.end)));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card className="grid gap-5 p-5">
      <div>
        <h2 className="text-lg font-semibold">{t('mentor.availability')}</h2>
        <p className="text-sm text-fg-2">{t('mentor.availabilityBody')}</p>
      </div>
      <Field label={t('mentor.timezone')}>
        {({ id }) => (
          <Select id={id} value={a.timezone} onChange={(e) => setA({ ...a, timezone: e.target.value })}>
            {zones.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </Select>
        )}
      </Field>
      <ul className="grid gap-3">
        {WEEK_ORDER.map((d) => {
          const r = rule(d);
          const label = dayName(d);
          return (
            <li
              key={d}
              className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-[var(--radius-md)] border border-line p-3 sm:grid-cols-[140px_minmax(0,1fr)]"
            >
              <label className="flex min-h-10 cursor-pointer items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={!!r}
                  onChange={(e) => setDay(d, e.target.checked ? [{ start: '18:00', end: '20:00' }] : [])}
                  className="size-5 accent-[var(--brand)]"
                />
                {label}
              </label>
              <div className="grid gap-2">
                {r?.windows.map((w, i) => (
                  <WindowRow
                    key={i}
                    w={w}
                    label={label}
                    onChange={(nw) =>
                      setDay(
                        d,
                        r.windows.map((x, j) => (j === i ? nw : x)),
                      )
                    }
                    onRemove={() =>
                      setDay(
                        d,
                        r.windows.filter((_, j) => j !== i),
                      )
                    }
                  />
                ))}
                {r && r.windows.length < 4 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="justify-self-start"
                    onClick={() => setDay(d, [...r.windows, { start: '20:00', end: '21:00' }])}
                  >
                    <Plus className="size-4" aria-hidden /> {t('mentor.addRange')}
                  </Button>
                )}
                {!r && <p className="self-center text-sm text-fg-3">{t('mentor.unavailable')}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      <section className="grid gap-2">
        <h3 className="font-semibold">{t('mentor.exceptions')}</h3>
        <p className="text-sm text-fg-2">{t('mentor.exceptionsBody')}</p>
        {a.exceptions.map((e, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              min={today}
              aria-label={t('mentor.exceptionDate')}
              value={e.date}
              onChange={(ev) =>
                setA({
                  ...a,
                  exceptions: a.exceptions.map((x, j) => (j === i ? { ...x, date: ev.target.value } : x)),
                })
              }
              className="min-h-10 w-44"
            />
            <Badge>{t('mentor.offAllDay')}</Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('mentor.removeException')}
              onClick={() => setA({ ...a, exceptions: a.exceptions.filter((_, j) => j !== i) })}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="justify-self-start"
          disabled={a.exceptions.some((x) => x.date === today)}
          onClick={() => setA({ ...a, exceptions: [...a.exceptions, { date: today, windows: [] }] })}
        >
          <Plus className="size-4" aria-hidden /> {t('mentor.addException')}
        </Button>
      </section>
      {invalid && (
        <p role="alert" className="text-sm text-danger">
          {t('mentor.rangeInvalid')}
        </p>
      )}
      <Button
        variant="primary"
        className="justify-self-start"
        disabled={invalid}
        loading={save.isPending}
        onClick={() => save.mutate()}
      >
        {t('mentor.saveAvailability')}
      </Button>
    </Card>
  );
}

function FeedbackList() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['my-feedback'],
    queryFn: () => api.get<FeedbackView[]>('/me/mentor/feedback'),
  });
  return (
    <section className="grid gap-3" aria-labelledby="feedback-h">
      <div>
        <h2 id="feedback-h" className="text-lg font-semibold">
          {t('mentor.feedback')}
        </h2>
        <p className="text-sm text-fg-2">{t('mentor.feedbackPrivate')}</p>
      </div>
      {q.isSuccess && !q.data.length && <p className="text-sm text-fg-3">{t('mentor.noFeedback')}</p>}
      <ul className="grid gap-2">
        {q.data?.map((f) => (
          <li key={f.id}>
            <Card className="grid gap-1.5 p-4">
              <div className="flex items-center justify-between gap-2">
                <b>{f.mentee.name}</b>
                <span role="img" aria-label={t('sessions.stars', { count: f.rating })} className="flex">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      aria-hidden
                      className={
                        n <= f.rating ? 'size-4 fill-[var(--accent)] text-accent-ink' : 'size-4 text-fg-3'
                      }
                    />
                  ))}
                </span>
              </div>
              {f.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {f.tags.map((tag) => (
                    <Badge key={tag}>{t(`sessions.tag.${tag}`)}</Badge>
                  ))}
                </div>
              )}
              {f.comment && <p className="text-sm">{f.comment}</p>}
              <p className="text-xs text-fg-3">{formatRelative(f.createdAt)}</p>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MentorDashboard() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['mentor-settings'],
    queryFn: () => api.get<MentorSettingsView>('/me/mentor'),
  });
  return (
    <>
      <h1 className="text-[clamp(26px,4vw,34px)] font-bold">{t('nav.mentor')}</h1>
      <ImpactCard />
      {q.isLoading && <Skeleton className="h-80" />}
      {q.data && (
        <>
          <SettingsForm initial={q.data} />
          <AvailabilityEditor initial={q.data.availability} />
        </>
      )}
      {q.isError && <EmptyState icon={<HeartHandshake className="size-6" />} title={t('errors.generic')} />}
      <FeedbackList />
    </>
  );
}
