import { useDeferredValue, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Dialog as D } from 'radix-ui';
import {
  BriefcaseBusiness,
  ListChecks,
  Languages,
  MessageCircleQuestion,
  Newspaper,
  SunMoon,
  Orbit,
  CalendarDays,
} from 'lucide-react';
import type {
  EventView,
  JobView,
  PostView,
  PublicProfile,
  QuestionView,
  RoadmapSummaryView,
} from '@campuslink/shared';
import { api } from '../../lib/api';
import { usePalette } from '../../lib/palette';
import { useDialogHistory } from '../../lib/use-dialog-history';
import { useCan } from '../../lib/me';
import { usePreferences } from '../../lib/preferences';
import { PersonAvatar } from '../ui/person-avatar';
import { useNav } from '../../lib/nav';

const item =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-3 text-meta data-[selected=true]:bg-surface-2';
const group =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-fg-3 [&_[cmdk-group-heading]]:uppercase';

export function CommandPalette() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { open, setOpen } = usePalette();
  const canSearch = useCan('directory:read');
  const canJobs = useCan('jobs:read');
  const { setTheme, setLanguage } = usePreferences();
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q.trim());
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
    enabled: open && canSearch && dq.length >= 2,
    staleTime: 30_000,
  });
  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) setQ('');
  };
  // Back closes the palette (it is full screen on phones).
  const requestChange = useDialogHistory(open, onOpenChange);
  const go = (to: string) => {
    setOpen(false);
    setQ('');
    // Replace the palette's own history entry, so Back from the destination skips it.
    const onPaletteEntry = (window.history.state as { usr?: { dialog?: string } } | null)?.usr?.dialog;
    navigate(to, { replace: onPaletteEntry !== undefined });
  };
  // "Go to" lists the same destinations as the tabs and the avatar menu (one navigation model).
  const model = useNav();
  const nav = [
    ...model.tabs.filter((n) => n.id !== 'create'),
    ...model.menu.flatMap((g) => g.items),
    ...(canJobs ? [{ id: 'tracker', to: '/jobs/tracker', label: t('jobs.tracker'), icon: ListChecks }] : []),
  ];

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
              {dq.length >= 2 && canSearch && (
                <Command.Group heading={t('palette.people')} className={group}>
                  {people.data?.people.map((p) => (
                    <Command.Item
                      key={p.userId}
                      value={`person-${p.userId}`}
                      onSelect={() => go(`/people/${p.userId}`)}
                      className={item}
                    >
                      <PersonAvatar name={p.name} fileId={p.avatarFileId} size={28} />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="truncate text-caption text-fg-3">
                        {p.fields.company ?? p.fields.headline ?? ''}
                      </span>
                    </Command.Item>
                  ))}
                  {people.isSuccess && !people.data.people.length && (
                    <p className="px-3 py-2 text-meta text-fg-2">{t('palette.noResults')}</p>
                  )}
                </Command.Group>
              )}
              {!!people.data?.roadmaps?.length && (
                <Command.Group heading={t('palette.roadmaps')} className={group}>
                  {people.data.roadmaps.map((r) => (
                    <Command.Item
                      key={r.id}
                      value={`roadmap-${r.id}`}
                      onSelect={() => go(`/roadmaps/${r.slug}`)}
                      className={item}
                    >
                      <Orbit className="size-4 flex-none text-fg-2" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{r.title}</span>
                      <span className="truncate text-caption text-fg-3">
                        {t(`roadmaps.cat.${r.category}`)}
                      </span>
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
                      onSelect={() => go(`/events/${e.id}`)}
                      className={item}
                    >
                      <CalendarDays className="size-4 flex-none text-fg-2" aria-hidden />
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
                      onSelect={() => go(`/jobs/${j.id}`)}
                      className={item}
                    >
                      <BriefcaseBusiness className="size-4 flex-none text-fg-2" aria-hidden />
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
                      <Newspaper className="size-4 flex-none text-fg-2" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        {p.body || p.link?.title || p.author.name}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {dq.length >= 3 && !!people.data?.questions?.length && (
                <Command.Group heading={t('palette.questions')} className={group}>
                  {people.data.questions.map((q) => (
                    <Command.Item
                      key={q.id}
                      value={`q-${q.id}`}
                      onSelect={() => go(`/questions/${q.id}`)}
                      className={item}
                    >
                      <MessageCircleQuestion className="size-4 flex-none text-fg-2" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{q.title}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading={t('palette.goTo')} className={group}>
                {nav
                  .filter((n) => !dq || n.label.toLowerCase().includes(dq.toLowerCase()))
                  .map((n) => (
                    <Command.Item key={n.to} value={`nav-${n.to}`} onSelect={() => go(n.to)} className={item}>
                      <n.icon className="size-4 text-fg-2" aria-hidden /> {n.label}
                    </Command.Item>
                  ))}
              </Command.Group>
              <Command.Group heading={t('palette.prefs')} className={group}>
                <Command.Item
                  value="theme"
                  onSelect={() =>
                    setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light')
                  }
                  className={item}
                >
                  <SunMoon className="size-4 text-fg-2" aria-hidden /> {t('palette.toggleTheme')}
                </Command.Item>
                <Command.Item
                  value="lang"
                  onSelect={() => setLanguage(i18n.language === 'te' ? 'en' : 'te')}
                  className={item}
                >
                  <Languages className="size-4 text-fg-2" aria-hidden /> {t('palette.switchLang')}
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
