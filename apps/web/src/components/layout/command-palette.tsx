import { useDeferredValue, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Dialog as D } from 'radix-ui';
import {
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ClipboardList,
  History,
  Languages,
  ListChecks,
  MessageCircleQuestion,
  Newspaper,
  Orbit,
  Plus,
  SunMoon,
  User,
  type LucideIcon,
} from 'lucide-react';
import {
  CREATE_ACTIONS,
  type AdminSectionId,
  type EventView,
  type JobView,
  type NavId,
  type PostView,
  type PublicProfile,
  type QuestionView,
  type RoadmapSummaryView,
  nextLocale,
} from '@campuslink/shared';
import { api } from '../../lib/api';
import { usePalette } from '../../lib/palette';
import { useDialogHistory } from '../../lib/use-dialog-history';
import { useCan } from '../../lib/me';
import { usePreferences } from '../../lib/preferences';
import { companies, placementDrives, subjects } from '../../lib/queries';
import { recentItems, rememberRecent, type RecentItem } from '../../lib/recent';
import { NAV_ICONS } from '../../lib/nav-icons';
import { ADMIN_ICONS } from '../../lib/admin-icons';
import { PersonAvatar } from '../ui/person-avatar';
import { useNav } from '../../lib/nav';
import { useTenant } from '../../lib/tenant-context';

const item =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-3 text-callout data-[selected=true]:bg-hover';
const group =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-3';
const lead = 'size-5 flex-none text-fg-2';

const RECENT_ICONS: Record<RecentItem['kind'], LucideIcon> = {
  person: User,
  company: Building2,
  drive: ClipboardList,
  roadmap: Orbit,
  subject: BookOpen,
  event: CalendarDays,
  job: BriefcaseBusiness,
  post: Newspaper,
  question: MessageCircleQuestion,
  page: History,
};

/**
 * Search and the command palette (prompt 3, U2): people, companies, drives, roadmaps, subjects,
 * events, jobs, posts and questions; every section of the member's spaces; the things they can
 * create; and, before anything is typed, what they opened last. One query box, the fastest way
 * anywhere for someone who knows what they want.
 */
export function CommandPalette() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const tenant = useTenant();
  const { open, setOpen } = usePalette();
  const canSearch = useCan('directory:read');
  const canJobs = useCan('jobs:read');
  const canCompanies = useCan('companies:view') && tenant.features?.placements !== false;
  const canDrives = useCan('placements:view') && tenant.features?.placements !== false;
  const canStudy = useCan('study:read') && tenant.features?.study !== false;
  const { setTheme, setLanguage } = usePreferences();
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q.trim());
  const needle = dq.toLowerCase();
  const searching = open && dq.length >= 2;
  const people = useQuery({
    queryKey: ['search', dq],
    queryFn: ({ signal }) =>
      api.get<{
        people: PublicProfile[];
        posts?: PostView[];
        questions?: QuestionView[];
        jobs?: JobView[];
        roadmaps?: RoadmapSummaryView[];
        events?: EventView[];
      }>(`/search?q=${encodeURIComponent(dq)}`, signal),
    enabled: searching && canSearch,
    staleTime: 30_000,
  });
  // Companies and subjects are searched by their own lists; drives are few, so they are filtered here.
  const companyHits = useQuery({ ...companies(dq), enabled: searching && canCompanies, staleTime: 30_000 });
  const subjectHits = useQuery({ ...subjects('all', dq), enabled: searching && canStudy, staleTime: 30_000 });
  const driveList = useQuery({
    ...placementDrives('all'),
    enabled: searching && canDrives,
    staleTime: 60_000,
  });
  const drives = (driveList.data ?? [])
    .filter((d) => `${d.company.name} ${d.title}`.toLowerCase().includes(needle))
    .slice(0, 5);

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) setQ('');
  };
  // Back closes the palette (it is full screen on phones).
  const requestChange = useDialogHistory(open, onOpenChange);
  const go = (to: string, recent?: Omit<RecentItem, 'to'>) => {
    if (recent) rememberRecent({ to, ...recent });
    setOpen(false);
    setQ('');
    // Replace the palette's own history entry, so Back from the destination skips it.
    const onPaletteEntry = (window.history.state as { usr?: { dialog?: string } } | null)?.usr?.dialog;
    navigate(to, { replace: onPaletteEntry !== undefined });
  };

  // "Go to" lists every section of the member's spaces (one navigation model).
  const model = useNav();
  const iconOf = (key: string): LucideIcon =>
    key.startsWith('admin:') ? ADMIN_ICONS[key.slice(6) as AdminSectionId] : NAV_ICONS[key as NavId];
  const nav = [
    ...model.spaces.flatMap((s) =>
      s.sections
        .filter((x) => !x.locked)
        .map((x) => ({
          to: x.to,
          // Two spaces can each have a "Home" or an "Overview": say whose it is.
          label: x.label === s.label ? x.label : `${s.label} · ${x.label}`,
          icon: iconOf(x.key),
        })),
    ),
    ...(canJobs ? [{ to: '/jobs/tracker', label: t('jobs.tracker'), icon: ListChecks }] : []),
  ].filter((n) => !needle || n.label.toLowerCase().includes(needle));
  const actions = CREATE_ACTIONS.filter((a) => model.create.includes(a.id))
    .map((a) => ({ to: a.path, label: t(`nav.createActions.${a.id}`) }))
    .filter((a) => !needle || a.label.toLowerCase().includes(needle));
  const recent = open && !dq ? recentItems() : [];
  const companyList = (companyHits.data?.items ?? []).slice(0, 5);
  const subjectList = (subjectHits.data ?? []).slice(0, 5);
  const found =
    !!people.data?.people.length ||
    companyList.length > 0 ||
    drives.length > 0 ||
    subjectList.length > 0 ||
    !!people.data?.roadmaps?.length ||
    !!people.data?.events?.length ||
    !!people.data?.jobs?.length ||
    !!people.data?.posts?.length ||
    !!people.data?.questions?.length ||
    nav.length > 0 ||
    actions.length > 0;
  const settled =
    !people.isFetching && !companyHits.isFetching && !subjectHits.isFetching && !driveList.isFetching;

  return (
    <D.Root open={open} onOpenChange={requestChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[80] bg-[var(--scrim)] backdrop-blur-[4px]" />
        <D.Content
          aria-describedby={undefined}
          className="fixed top-[calc(12vh+env(safe-area-inset-top,0px))] left-1/2 z-[81] w-[min(580px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[var(--radius-lg)] border border-line-strong bg-surface-1 shadow-[var(--shadow)]"
        >
          <D.Title className="sr-only">{t('palette.label')}</D.Title>
          <Command label={t('palette.label')} shouldFilter={false} loop>
            <Command.Input
              enterKeyHint="search"
              value={q}
              onValueChange={setQ}
              placeholder={t('palette.placeholder')}
              className="min-h-14 w-full border-b border-line bg-transparent px-4 text-body outline-none"
            />
            <Command.List className="max-h-[55vh] overflow-y-auto p-2">
              {recent.length > 0 && (
                <Command.Group heading={t('palette.recent')} className={group}>
                  {recent.map((r) => {
                    const Icon = RECENT_ICONS[r.kind] ?? History;
                    return (
                      <Command.Item
                        key={r.to}
                        value={`recent-${r.to}`}
                        onSelect={() => go(r.to, { label: r.label, kind: r.kind })}
                        className={item}
                      >
                        <Icon className={lead} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              )}
              {!!people.data?.people.length && (
                <Command.Group heading={t('palette.people')} className={group}>
                  {people.data.people.map((p) => (
                    <Command.Item
                      key={p.userId}
                      value={`person-${p.userId}`}
                      onSelect={() => go(`/people/${p.userId}`, { label: p.name, kind: 'person' })}
                      className={item}
                    >
                      <PersonAvatar name={p.name} fileId={p.avatarFileId} size={28} />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="truncate text-caption text-fg-3">
                        {p.fields.company ?? p.fields.headline ?? ''}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {companyList.length > 0 && (
                <Command.Group heading={t('palette.companies')} className={group}>
                  {companyList.map((c) => (
                    <Command.Item
                      key={c.key}
                      value={`company-${c.key}`}
                      onSelect={() =>
                        go(`/companies/${encodeURIComponent(c.key)}`, { label: c.name, kind: 'company' })
                      }
                      className={item}
                    >
                      <Building2 className={lead} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {drives.length > 0 && (
                <Command.Group heading={t('palette.drives')} className={group}>
                  {drives.map((d) => (
                    <Command.Item
                      key={d.id}
                      value={`drive-${d.id}`}
                      onSelect={() =>
                        go(`/placements/${d.id}`, { label: `${d.company.name} · ${d.title}`, kind: 'drive' })
                      }
                      className={item}
                    >
                      <ClipboardList className={lead} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{d.title}</span>
                      <span className="truncate text-caption text-fg-3">{d.company.name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!!people.data?.roadmaps?.length && (
                <Command.Group heading={t('palette.roadmaps')} className={group}>
                  {people.data.roadmaps.map((r) => (
                    <Command.Item
                      key={r.id}
                      value={`roadmap-${r.id}`}
                      onSelect={() => go(`/roadmaps/${r.slug}`, { label: r.title, kind: 'roadmap' })}
                      className={item}
                    >
                      <Orbit className={lead} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{r.title}</span>
                      <span className="truncate text-caption text-fg-3">
                        {t(`roadmaps.cat.${r.category}`)}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {subjectList.length > 0 && (
                <Command.Group heading={t('palette.subjects')} className={group}>
                  {subjectList.map((s) => (
                    <Command.Item
                      key={s.id}
                      value={`subject-${s.id}`}
                      onSelect={() => go(`/study/${s.id}`, { label: s.name, kind: 'subject' })}
                      className={item}
                    >
                      <BookOpen className={lead} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="truncate font-mono text-caption text-fg-3">{s.code}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!!people.data?.events?.length && (
                <Command.Group heading={t('palette.events')} className={group}>
                  {people.data.events.map((e) => (
                    <Command.Item
                      key={e.id}
                      value={`event-${e.id}`}
                      onSelect={() => go(`/events/${e.id}`, { label: e.title, kind: 'event' })}
                      className={item}
                    >
                      <CalendarDays className={lead} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{e.title}</span>
                      <span className="truncate text-caption text-fg-3">{t(`events.kind.${e.kind}`)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {dq.length >= 3 && !!people.data?.jobs?.length && (
                <Command.Group heading={t('palette.jobs')} className={group}>
                  {people.data.jobs.map((j) => (
                    <Command.Item
                      key={j.id}
                      value={`job-${j.id}`}
                      onSelect={() => go(`/jobs/${j.id}`, { label: j.title, kind: 'job' })}
                      className={item}
                    >
                      <BriefcaseBusiness className={lead} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{j.title}</span>
                      <span className="truncate text-caption text-fg-3">{j.company}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {dq.length >= 3 && !!people.data?.posts?.length && (
                <Command.Group heading={t('palette.posts')} className={group}>
                  {people.data.posts.map((p) => (
                    <Command.Item
                      key={p.id}
                      value={`post-${p.id}`}
                      onSelect={() => go(`/posts/${p.id}`)}
                      className={item}
                    >
                      <Newspaper className={lead} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        {p.body || p.link?.title || p.author.name}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {dq.length >= 3 && !!people.data?.questions?.length && (
                <Command.Group heading={t('palette.questions')} className={group}>
                  {people.data.questions.map((x) => (
                    <Command.Item
                      key={x.id}
                      value={`q-${x.id}`}
                      onSelect={() => go(`/questions/${x.id}`, { label: x.title, kind: 'question' })}
                      className={item}
                    >
                      <MessageCircleQuestion className={lead} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{x.title}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {actions.length > 0 && (
                <Command.Group heading={t('palette.actions')} className={group}>
                  {actions.map((a) => (
                    <Command.Item
                      key={a.to}
                      value={`action-${a.to}`}
                      onSelect={() => go(a.to)}
                      className={item}
                    >
                      <Plus className={lead} aria-hidden /> {a.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {nav.length > 0 && (
                <Command.Group heading={t('palette.goTo')} className={group}>
                  {nav.map((n) => (
                    <Command.Item
                      key={n.to}
                      value={`nav-${n.to}`}
                      onSelect={() => go(n.to, { label: n.label, kind: 'page' })}
                      className={item}
                    >
                      <n.icon className={lead} aria-hidden /> {n.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {searching && settled && !found && (
                <p className="px-3 py-3 text-callout text-fg-2">{t('palette.noResults')}</p>
              )}
              <Command.Group heading={t('palette.prefs')} className={group}>
                <Command.Item
                  value="theme"
                  onSelect={() =>
                    setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light')
                  }
                  className={item}
                >
                  <SunMoon className={lead} aria-hidden /> {t('palette.toggleTheme')}
                </Command.Item>
                <Command.Item
                  value="lang"
                  onSelect={() => setLanguage(nextLocale(i18n.language))}
                  className={item}
                >
                  <Languages className={lead} aria-hidden /> {t('palette.switchLang')}
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
