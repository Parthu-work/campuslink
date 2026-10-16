import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, MapPin, Plus, Users, Video } from 'lucide-react';
import {
  BRANCHES,
  EVENT_AUDIENCES,
  EVENT_KINDS,
  EVENT_MODES,
  HOSTED_KINDS,
  eventBody,
  type EventKind,
  type EventView,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { Segmented } from '../../components/ui/tab-nav';
import { api, ApiError } from '../../lib/api';
import { useCan } from '../../lib/me';
import { formatDateTime, newIdempotencyKey } from '../../lib/format';
import { fromLocalInput, toLocalInput } from '../../lib/events';

export function EventCard({ e }: { e: EventView }) {
  const { t } = useTranslation();
  return (
    <Card className="relative grid h-full gap-2 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="brand">{t(`events.kind.${e.kind}`)}</Badge>
        {e.status === 'cancelled' && <Badge tone="danger">{t('events.cancelled')}</Badge>}
        {e.myRsvp && <Badge tone="success">{t(`events.rsvp.${e.myRsvp}`)}</Badge>}
      </div>
      <Link
        to={`/events/${e.id}`}
        className="font-display text-lg leading-tight font-semibold after:absolute after:inset-0"
      >
        {e.title}
      </Link>
      <p className="flex items-center gap-1.5 text-sm text-fg-2">
        <CalendarDays className="size-4 flex-none" aria-hidden /> {formatDateTime(e.startsAt)}
      </p>
      <p className="flex items-center gap-1.5 text-sm text-fg-2">
        {e.mode === 'online' ? (
          <Video className="size-4 flex-none" aria-hidden />
        ) : (
          <MapPin className="size-4 flex-none" aria-hidden />
        )}
        {e.mode === 'online' ? t('events.mode.online') : e.location}
      </p>
      <p className="flex items-center gap-1.5 text-xs text-fg-3">
        <Users className="size-3.5" aria-hidden />
        {e.capacity
          ? t('events.goingOf', { going: e.going, capacity: e.capacity })
          : t('events.goingN', { count: e.going })}
        {' · '}
        {t('events.hostedBy', { name: e.host.name })}
      </p>
    </Card>
  );
}

export function EventsPage() {
  const { t } = useTranslation();
  const canCreate = useCan('events:create');
  const canHost = useCan('ama:host');
  const [when, setWhen] = useState<'upcoming' | 'mine' | 'past'>('upcoming');
  const [kind, setKind] = useState<EventKind | ''>('');
  const q = useQuery({
    queryKey: ['events', when, kind],
    queryFn: () => api.get<EventView[]>(`/events?when=${when}${kind ? `&kind=${kind}` : ''}`),
  });
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[clamp(26px,4vw,34px)] font-bold">
            <CalendarDays className="size-7 text-brand-ink" aria-hidden /> {t('events.title')}
          </h1>
          <p className="max-w-[60ch] text-fg-2">{t('events.intro')}</p>
        </div>
        {(canCreate || canHost) && (
          <Link to="/events/new" className={buttonVariants({ size: 'sm', variant: 'primary' })}>
            <Plus className="size-4" aria-hidden /> {canCreate ? t('events.new') : t('events.newAma')}
          </Link>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <Segmented
          label={t('events.show')}
          value={when}
          onChange={setWhen}
          options={[
            ['upcoming', t('events.upcoming')],
            ['mine', t('events.mine')],
            ['past', t('events.past')],
          ]}
        />
        <Select
          aria-label={t('events.kindLabel')}
          value={kind}
          onChange={(e) => setKind(e.target.value as EventKind | '')}
        >
          <option value="">{t('events.allKinds')}</option>
          {EVENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`events.kind.${k}`)}
            </option>
          ))}
        </Select>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : !q.data?.length ? (
        <EmptyState icon={<CalendarDays className="size-6" />} title={t('events.empty')} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((e) => (
            <li key={e.id}>
              <EventCard e={e} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Form = {
  title: string;
  description: string;
  kind: EventKind;
  mode: (typeof EVENT_MODES)[number];
  startsAt: string;
  endsAt: string;
  location: string;
  onlineUrl: string;
  capacity: string;
  audience: (typeof EVENT_AUDIENCES)[number];
  branches: string[];
  notifyChange: boolean;
};

export function EventFormPage() {
  const { id } = useParams();
  const existing = useQuery({
    queryKey: ['event', id],
    queryFn: () => api.get<EventView>(`/events/${id ?? ''}`),
    enabled: !!id,
  });
  if (id && !existing.data) return <Skeleton className="h-96" />;
  return <EventForm key={id ?? 'new'} existing={existing.data ?? null} />;
}

function EventForm({ existing }: { existing: EventView | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canCreate = useCan('events:create');
  const kinds = canCreate ? EVENT_KINDS : EVENT_KINDS.filter((k) => HOSTED_KINDS.includes(k));
  const [key] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Form>(() =>
    existing
      ? {
          title: existing.title,
          description: existing.description,
          kind: existing.kind,
          mode: existing.mode,
          startsAt: toLocalInput(existing.startsAt),
          endsAt: toLocalInput(existing.endsAt),
          location: existing.location,
          onlineUrl: existing.onlineUrl ?? '',
          capacity: existing.capacity ? String(existing.capacity) : '',
          audience: existing.audience,
          branches: existing.branches,
          notifyChange: true,
        }
      : {
          title: '',
          description: '',
          kind: kinds[0] ?? 'ama',
          mode: 'online',
          startsAt: '',
          endsAt: '',
          location: '',
          onlineUrl: '',
          capacity: '',
          audience: 'everyone',
          branches: [],
          notifyChange: true,
        },
  );
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });
  const payload = {
    title: f.title,
    description: f.description,
    kind: f.kind,
    mode: f.mode,
    startsAt: fromLocalInput(f.startsAt),
    endsAt: fromLocalInput(f.endsAt),
    location: f.mode === 'online' ? '' : f.location,
    onlineUrl: f.mode === 'in_person' || !f.onlineUrl ? null : f.onlineUrl,
    capacity: f.capacity ? Number(f.capacity) : null,
    audience: f.audience,
    branches: f.branches,
  };
  const parsed = eventBody.safeParse(payload);
  const issues = parsed.success ? [] : [...new Set(parsed.error.issues.map((i) => i.message))].slice(0, 4);
  const save = async () => {
    if (!parsed.success) return;
    setBusy(true);
    try {
      const view = existing
        ? await api.put<EventView>(`/events/${existing.id}`, { ...payload, notifyChange: f.notifyChange })
        : await api.postOnce<EventView>('/events', payload, key);
      qc.setQueryData(['event', view.id], view);
      void qc.invalidateQueries({ queryKey: ['events'] });
      toast.success(existing ? t('events.saved') : t('events.created'));
      navigate(`/events/${view.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };
  const input = (
    k: 'title' | 'location' | 'onlineUrl',
    label: string,
    extra: Record<string, unknown> = {},
  ) => (
    <Field label={label}>
      {(fl) => (
        <Input
          id={fl.id}
          aria-describedby={fl.describedBy}
          value={f[k]}
          onChange={(e) => set(k, e.target.value)}
          {...extra}
        />
      )}
    </Field>
  );
  return (
    <form
      className="grid max-w-3xl gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h1 className="text-[clamp(24px,4vw,30px)] font-bold">
        {existing ? t('events.edit') : t('events.new')}
      </h1>
      {input('title', t('events.form.title'), { maxLength: 120 })}
      <Field label={t('events.form.description')}>
        {(fl) => (
          <Textarea
            id={fl.id}
            aria-describedby={fl.describedBy}
            rows={4}
            maxLength={4000}
            value={f.description}
            onChange={(e) => set('description', e.target.value)}
          />
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('events.kindLabel')}>
          {(fl) => (
            <Select id={fl.id} value={f.kind} onChange={(e) => set('kind', e.target.value as EventKind)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(`events.kind.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('events.form.mode')}>
          {(fl) => (
            <Select id={fl.id} value={f.mode} onChange={(e) => set('mode', e.target.value as Form['mode'])}>
              {EVENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`events.mode.${m}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('events.form.starts')}>
          {(fl) => (
            <Input
              id={fl.id}
              type="datetime-local"
              value={f.startsAt}
              onChange={(e) => set('startsAt', e.target.value)}
            />
          )}
        </Field>
        <Field label={t('events.form.ends')}>
          {(fl) => (
            <Input
              id={fl.id}
              type="datetime-local"
              value={f.endsAt}
              onChange={(e) => set('endsAt', e.target.value)}
            />
          )}
        </Field>
      </div>
      {f.mode !== 'online' && input('location', t('events.form.venue'), { maxLength: 200 })}
      {f.mode !== 'in_person' && (
        <Field label={t('events.form.link')} hint={t('events.form.linkHint')}>
          {(fl) => (
            <Input
              id={fl.id}
              aria-describedby={fl.describedBy}
              type="url"
              inputMode="url"
              placeholder="https://"
              value={f.onlineUrl}
              onChange={(e) => set('onlineUrl', e.target.value.trim())}
            />
          )}
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('events.form.capacity')} hint={t('events.form.capacityHint')}>
          {(fl) => (
            <Input
              id={fl.id}
              aria-describedby={fl.describedBy}
              type="number"
              min={1}
              value={f.capacity}
              onChange={(e) => set('capacity', e.target.value)}
            />
          )}
        </Field>
        <Field label={t('events.form.audience')}>
          {(fl) => (
            <Select
              id={fl.id}
              value={f.audience}
              onChange={(e) => set('audience', e.target.value as Form['audience'])}
            >
              {EVENT_AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {t(`events.audience.${a}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-semibold">{t('events.form.branches')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {BRANCHES.map((b) => (
            <Checkbox
              key={b}
              id={`ev-branch-${b}`}
              checked={f.branches.includes(b)}
              onChange={(v) => set('branches', v ? [...f.branches, b] : f.branches.filter((x) => x !== b))}
            >
              {b}
            </Checkbox>
          ))}
        </div>
      </fieldset>
      {existing && (
        <Checkbox id="ev-notify" checked={f.notifyChange} onChange={(v) => set('notifyChange', v)}>
          {t('events.form.notify')}
        </Checkbox>
      )}
      {!!issues.length && (f.title || f.startsAt) && (
        <ul className="list-disc pl-5 text-sm text-danger" aria-live="polite">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      <Button
        type="submit"
        variant="primary"
        className="justify-self-start"
        loading={busy}
        disabled={!parsed.success}
      >
        {existing ? t('events.saveChanges') : t('events.create')}
      </Button>
    </form>
  );
}
