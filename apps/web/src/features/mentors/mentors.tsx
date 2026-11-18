import { useDeferredValue, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { BadgeCheck, Compass, Search } from 'lucide-react';
import { SESSION_TYPES, type MentorCard } from '@campuslink/shared';
import { IntentLink } from '../../components/ui/intent-link';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, Input, Select } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { Segmented } from '../../components/ui/tab-nav';
import { TagInput } from '../../components/ui/tag-input';
import { api } from '../../lib/api';
import { useFeature } from '../../lib/tenant-context';
import { coverOf } from '../../lib/accent';
import { SCREEN } from '../../lib/query-client';
import { MentorStatsLine } from './mentor-stats';
import { MatchView } from './match';
import { headlineAdds, isDemoMentor, roleLine, stripDemo } from './mentor-text';

/**
 * A mentor in a list (§8.4): a large face, what they do and where, their batch, a few topics, their
 * track record (reply time, sessions, rating; B5) and the sessions they offer.
 */
export function MentorTile({ m }: { m: MentorCard }) {
  const { t } = useTranslation();
  const headline = headlineAdds(m);
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
            <span className="flex gap-1">
              {isDemoMentor(m) && <Badge>{t('common.demo')}</Badge>}
              {!m.open && <Badge tone="warning">{t('mentors.full')}</Badge>}
            </span>
          </div>
          <div className="min-w-0">
            <b className="block truncate text-headline">{stripDemo(m.name)}</b>
            {(m.jobTitle || m.company) && (
              <p className="flex min-w-0 items-center gap-1 text-callout text-fg-2">
                <span className="truncate">{roleLine(m, t)}</span>
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
          {headline && <p className="line-clamp-2 text-callout text-fg-2">{headline}</p>}
          {m.stats && <MentorStatsLine stats={m.stats} />}
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

function BrowseView() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const [q, setQ] = useState(() => search.get('q') ?? '');
  const [type, setType] = useState(() => search.get('type') ?? '');
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
  // ?goals=1: Home's "Set up your CampusLink" opens the goals sheet straight away (prompt 3, U4).
  const [prefsOpen, setPrefsOpen] = useState(() => params.get('goals') === '1');
  // Without Alumni Match (Admin › Features) the page is the mentor list alone.
  const matching = useFeature('alumniMatch');
  const view = !matching || params.get('view') === 'browse' ? 'browse' : 'match';
  return (
    <>
      <PageHeader title={t('mentors.title')} />
      {matching && (
        <Segmented
          label={t('mentors.title')}
          value={view}
          options={[
            ['match', t('mentors.match')],
            ['browse', t('mentors.browse')],
          ]}
          onChange={(v) => setParams(v === 'browse' ? { view: 'browse' } : {}, { replace: true })}
        />
      )}
      <PrefsDialog open={prefsOpen} onOpenChange={setPrefsOpen} />
      {view === 'match' ? <MatchView onPrefs={() => setPrefsOpen(true)} /> : <BrowseView />}
    </>
  );
}
