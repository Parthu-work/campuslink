import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronRight, LogOut, Plus, Search } from 'lucide-react';
import { Crest } from '../ui/misc';
import { BackLink } from '../ui/back-link';
import { Kbd } from '../ui/skeletons';
import { PersonAvatar } from '../ui/person-avatar';
import { useTenant } from '../../lib/tenant-context';
import { useMe } from '../../lib/me';
import { useSignOut } from '../../lib/use-sign-out';
import { useRouteFocus } from '../../lib/route-focus';
import { useScrollMemory } from '../../lib/scroll-memory';
import { useScrollChrome } from '../../lib/use-scroll-chrome';
import { useSpaceMemory } from '../../lib/tab-memory';
import { intentPreload, preloadWhenIdle } from '../../lib/preload';
import { cn } from '../../lib/cn';
import { formatDay } from '../../lib/format';
import { paletteShortcut, useNav, type SectionEntry, type SpaceEntry } from '../../lib/nav';
import { usePalette, usePaletteShortcut } from '../../lib/palette';
import { useUrlOverlay } from '../../lib/use-url-overlay';
import { prefersReducedMotion } from '../../lib/preferences';
import { NavProgress } from './skeletons';
import { SpaceSections } from './space-sections';
import { useIdle } from '../../lib/use-idle';
import { lazyPart } from '../../lib/lazy-part';

// Not needed for the first screen (audit PF-1): the palette (cmdk), the account menu (Radix menu)
// and the sheets load after the first idle period, or at once when the member opens them.
// A part that cannot load (offline) keeps its placeholder and retries when the connection returns.
const CommandPalette = lazyPart(() => import('./command-palette').then((m) => m.CommandPalette));
const AccountMenu = lazyPart(() => import('./account-menu').then((m) => m.AccountMenu));
const AccountSheet = lazyPart(() => import('./account-menu').then((m) => m.AccountSheet));
const CreateSheet = lazyPart(() => import('./create-sheet').then((m) => m.CreateSheet));
// The socket connection and pull to refresh start after the first screen has painted.
const IdleParts = lazyPart(() => import('./idle-parts').then((m) => m.IdleParts));

/** How many sections the sidebar lists under the open space before "All in …": it never scrolls. */
const SIDEBAR_SECTIONS = 6;

/** Same size as the account button, while the menu's code loads (no layout shift). */
function AccountButtonPlaceholder({ name }: { name: string }) {
  return (
    <div aria-hidden className="flex min-h-12 items-center gap-3 px-2">
      <PersonAvatar name={name || '?'} fileId={null} size={36} />
      <span className="truncate text-callout font-bold">{name}</span>
    </div>
  );
}

function Count({ n, className }: { n: number; className?: string }) {
  const { t } = useTranslation();
  if (!n) return null;
  return (
    <span
      className={cn(
        'grid min-w-5 place-items-center rounded-full bg-brand px-1.5 text-caption leading-5 font-semibold text-on-brand tabular-nums',
        className,
      )}
    >
      {n > 99 ? '99+' : n}
      <span className="sr-only"> {t('nav.unread')}</span>
    </span>
  );
}

/**
 * Re-tapping the tab you are on scrolls to the top; tapping again at the top refreshes the screen
 * (the Instagram/LinkedIn convention, audit NB-3).
 */
function useReselect() {
  const location = useLocation();
  const qc = useQueryClient();
  return (to: string) => (e: MouseEvent) => {
    if (location.pathname !== to || location.search) return;
    e.preventDefault();
    if (window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } else void qc.refetchQueries({ type: 'active' });
  };
}

/** The sections the sidebar lists under the open space: all of them, or the first few and the current one. */
function listed(sections: SectionEntry[], current: string | null) {
  if (sections.length <= SIDEBAR_SECTIONS) return { rows: sections, more: false };
  const rows = sections.slice(0, SIDEBAR_SECTIONS - 1);
  const now = sections.find((x) => x.key === current);
  if (now && !rows.includes(now)) rows[rows.length - 1] = now;
  return { rows, more: true };
}

/**
 * The persistent signed-in shell (prompt 3, U2): it never unmounts on navigation. Every member has
 * at most five spaces. Desktop: a sidebar with Create, Search and the spaces, the open one listing
 * its sections (one level; it never scrolls). Phones: a top bar (search, one inbox, the account)
 * and the spaces as bottom tabs, with the open space's sections in a row under the bar. The space
 * that is lit is the one that owns the current screen, from the navigation model.
 */
export function AppShell({ platform = false }: { platform?: boolean }) {
  const tenant = useTenant();
  const { t } = useTranslation();
  const { data: me } = useMe();
  const signOut = useSignOut();
  const openPalette = usePalette((s) => s.setOpen);
  usePaletteShortcut();
  const nav = useNav();
  const sheet = useUrlOverlay('sheet');
  const idle = useIdle();
  const paletteOpen = usePalette((s) => s.open);
  const reselect = useReselect();
  const { pathname } = useLocation();
  const [touch] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  useRouteFocus(tenant.branding.shortName);
  const roots = useMemo(() => new Set(nav.spaces.map((s) => s.to)), [nav.spaces]);
  useScrollMemory(roots);
  useScrollChrome();
  // Every space's code is ready before the first tap (audit TR-1, TR-2).
  useEffect(() => preloadWhenIdle([...roots]), [roots]);

  const memory = useSpaceMemory(nav.model);
  const space = nav.spaces.find((s) => s.id === memory.active) ?? null;
  const section = space?.sections.find((x) => x.key === memory.section) ?? null;
  const atSection = !!section && pathname === section.to;
  const canCreate = nav.create.length > 0;
  const home = nav.spaces[0]?.to ?? (platform ? '/platform' : '/home');
  // Notifications and messages are two screens behind one entry (the inbox).
  const inInbox = !platform && (pathname === '/notifications' || pathname === '/messages');
  const inboxLabel = nav.inbox ? t('nav.inboxUnread', { count: nav.inbox }) : t('nav.inbox');

  const spaceLink = (s: SpaceEntry) => {
    const lit = s.id === memory.active;
    const to = memory.hrefFor(s);
    const { rows, more } = listed(s.sections, lit ? memory.section : null);
    return (
      <li key={s.id}>
        <Link
          to={to}
          aria-current={lit ? (pathname === s.to ? 'page' : 'true') : undefined}
          onClick={reselect(to)}
          {...intentPreload(to)}
          className="relative flex min-h-11 items-center gap-3 rounded-md px-3 text-callout font-semibold text-fg-2 hover:bg-hover hover:text-fg aria-[current]:text-fg"
        >
          <s.icon className={cn('size-5', lit && 'text-brand-ink')} aria-hidden />
          {s.label}
        </Link>
        {lit && s.sections.length > 1 && (
          <ul className="mt-0.5 mb-1.5 ml-[22px] grid gap-px border-l border-line pl-2.5">
            {rows.map((x) => (
              <li key={x.key}>
                <Link
                  to={x.to}
                  aria-current={x.key === memory.section ? 'page' : undefined}
                  {...intentPreload(x.to)}
                  className="flex min-h-8 items-center gap-2 rounded-sm px-2.5 text-callout text-fg-2 hover:bg-hover hover:text-fg aria-[current=page]:bg-brand-surface aria-[current=page]:font-semibold aria-[current=page]:text-brand-ink"
                >
                  <span className="min-w-0 flex-1 truncate">{x.label}</span>
                  <Count n={x.badge} />
                </Link>
              </li>
            ))}
            {more && (
              <li>
                <Link
                  to={s.browse}
                  aria-current={pathname === s.browse ? 'page' : undefined}
                  className="flex min-h-8 items-center gap-1 rounded-sm px-2.5 text-callout font-semibold text-brand-ink hover:bg-hover"
                >
                  {t('nav.allIn', { space: s.label })}
                  <ChevronRight className="size-4" aria-hidden />
                </Link>
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  const spaceTab = (s: SpaceEntry) => {
    const lit = s.id === memory.active;
    const to = memory.hrefFor(s);
    return (
      <Link
        key={s.id}
        to={to}
        aria-current={lit ? (pathname === s.to ? 'page' : 'true') : undefined}
        onClick={reselect(to)}
        {...intentPreload(to)}
        className="group relative grid min-h-[52px] min-w-0 justify-items-center gap-0.5 rounded-sm px-0.5 py-1.5 text-caption font-semibold text-fg-3 hover:text-fg aria-[current]:text-fg"
      >
        <span
          aria-hidden
          className="absolute top-0 hidden h-[3px] w-[22px] rounded-sm bg-brand group-aria-[current]:block"
        />
        <s.icon className="size-5" aria-hidden />
        {/* Full words in every language, never cut (the capture audit checks they fit). */}
        <span className="whitespace-nowrap">{s.label}</span>
      </Link>
    );
  };

  const inboxLink = (
    <Link
      to="/notifications"
      className="relative grid size-11 flex-none place-items-center rounded-full text-fg-2 hover:bg-hover"
      aria-label={inboxLabel}
      title={t('nav.inbox')}
    >
      <Bell className="size-5" aria-hidden />
      {nav.inbox > 0 && (
        <span aria-hidden className="absolute top-1 right-0.5">
          <Count n={nav.inbox} className="min-w-4 px-1 leading-4" />
        </span>
      )}
    </Link>
  );

  return (
    <div className="grid min-h-dvh lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-full focus:bg-surface-1 focus:px-4 focus:py-2"
      >
        {t('common.skipToContent')}
      </a>
      <NavProgress />

      {/* Desktop sidebar: Create, Search and the spaces; the account and the inbox at its foot. */}
      <nav
        aria-label={t('nav.main')}
        className="app-rail sticky top-0 hidden h-dvh min-h-0 flex-col border-r border-line lg:flex"
      >
        <Link
          to={home}
          className="flex items-center gap-2.5 px-4 pt-5 pb-4"
          title={tenant.branding.displayName}
        >
          <Crest monogram={tenant.branding.monogram} logoUrl={tenant.logoUrl} />
          <b className="text-callout leading-tight font-semibold">{tenant.branding.displayName}</b>
        </Link>
        <div className="grid min-h-0 flex-1 content-start gap-1.5 overflow-y-auto overscroll-contain px-3 pb-3">
          {canCreate && (
            <button
              type="button"
              onClick={() => sheet.open('create')}
              aria-haspopup="dialog"
              className="flex min-h-11 items-center gap-2 rounded-md bg-brand px-4 text-callout font-semibold text-on-brand hover:bg-brand-hover"
            >
              <Plus className="size-5" aria-hidden />
              {t('nav.create')}
            </button>
          )}
          {!platform && (
            <button
              type="button"
              onClick={() => openPalette(true)}
              className="flex min-h-11 items-center gap-2.5 rounded-md border border-line bg-surface-1 px-3 text-callout text-fg-2 hover:text-fg"
            >
              <Search className="size-5" aria-hidden />
              {t('palette.open')}
              <span className="ml-auto">
                <Kbd>{paletteShortcut()}</Kbd>
              </span>
            </button>
          )}
          <ul className="mt-1.5 grid gap-0.5">{nav.spaces.map(spaceLink)}</ul>
        </div>
        <div className="flex items-center gap-1 border-t border-line p-3">
          <div className="min-w-0 flex-1">
            <AccountMenu platform={platform} fallback={<AccountButtonPlaceholder name={me?.name ?? ''} />} />
          </div>
          {!platform && inboxLink}
        </div>
      </nav>

      {/* Phone top bar: the college, search, one inbox, the account. */}
      <header
        data-chrome-bar
        className="chrome-top gutter fixed inset-x-0 top-0 z-40 flex items-center gap-1 border-b pt-[calc(8px+env(safe-area-inset-top,0px))] pb-2 lg:hidden"
      >
        <Link to={home} className="flex min-h-11 min-w-0 items-center gap-2.5 pr-2">
          <Crest monogram={tenant.branding.monogram} logoUrl={tenant.logoUrl} size={32} />
          <b className="truncate text-body font-semibold">{tenant.branding.shortName}</b>
        </Link>
        <div className="ml-auto flex items-center">
          {!platform && (
            <button
              type="button"
              onClick={() => openPalette(true)}
              className="grid size-11 place-items-center rounded-full text-fg-2 hover:bg-hover"
              aria-label={t('palette.open')}
            >
              <Search className="size-5" aria-hidden />
            </button>
          )}
          {!platform && inboxLink}
          {platform ? (
            <button
              type="button"
              onClick={() => void signOut()}
              className="grid size-11 place-items-center rounded-full text-fg-2 hover:bg-hover"
              aria-label={t('common.signOut')}
            >
              <LogOut className="size-5" aria-hidden />
            </button>
          ) : (
            me && (
              <button
                type="button"
                onClick={() => sheet.open('account')}
                className="grid size-11 place-items-center rounded-full hover:bg-hover"
                aria-label={t('nav.accountMenu', { name: me.name })}
                aria-haspopup="dialog"
              >
                <PersonAvatar name={me.name} fileId={null} size={32} />
              </button>
            )
          )}
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className="gutter min-w-0 pt-[calc(68px+env(safe-area-inset-top,0px))] pb-[calc(96px+env(safe-area-inset-bottom,0px))] outline-none lg:py-8"
      >
        <div className="mx-auto grid max-w-[880px] grid-cols-[minmax(0,1fr)] gap-5">
          {me?.deletionPurgeAt && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-danger bg-surface-1 p-3 text-callout"
            >
              <span>{t('settings.data.banner', { date: formatDay(me.deletionPurgeAt) })}</span>
              <Link to="/settings/data" className="font-semibold text-brand-ink underline">
                {t('settings.data.cancel')}
              </Link>
            </div>
          )}
          {tenant.readOnly && (
            <p
              role="status"
              className="rounded-[var(--radius-md)] border border-warning bg-warning-surface p-3 text-callout text-warning-ink"
            >
              {t('billing.memberReadOnly')}
            </p>
          )}
          {/* Desktop, below a section's first screen: where this is (space › section). */}
          {space && section && !atSection && (
            <nav aria-label={t('nav.youAreHere')} className="hidden lg:block">
              <ol className="flex flex-wrap items-center gap-1 text-callout text-fg-2">
                <li>
                  <Link to={space.to} className="rounded-sm hover:text-fg hover:underline">
                    {space.label}
                  </Link>
                </li>
                <li aria-hidden>
                  <ChevronRight className="size-4 text-fg-3" />
                </li>
                <li>
                  <Link to={section.to} className="rounded-sm hover:text-fg hover:underline">
                    {section.label}
                  </Link>
                </li>
              </ol>
            </nav>
          )}
          {/* The inbox's two screens carry their own switch instead of a section row. */}
          {space &&
            atSection &&
            !inInbox &&
            (space.hub ? (
              // A space that opens on its own list: its sections lead back to it.
              <BackLink to={space.to} className="lg:hidden">
                {space.label}
              </BackLink>
            ) : (
              space.sections.length > 1 && (
                <div className="lg:hidden">
                  <SpaceSections space={space} current={memory.section} />
                </div>
              )
            ))}
          <Outlet />
        </div>
      </main>

      {!platform && (idle || paletteOpen) && <CommandPalette />}
      {!platform && (idle || sheet.value === 'account') && <AccountSheet />}
      {canCreate && (idle || sheet.value === 'create') && <CreateSheet />}
      {idle && <IdleParts realtime={!platform} pull={touch} />}

      {/* Phones: Create floats on Home only; elsewhere it is each screen's own primary action. */}
      {canCreate && pathname === '/home' && (
        <button
          type="button"
          onClick={() => sheet.open('create')}
          aria-label={t('nav.create')}
          aria-haspopup="dialog"
          className="fixed right-4 bottom-[calc(80px+env(safe-area-inset-bottom,0px))] z-30 grid size-14 place-items-center rounded-full bg-brand text-on-brand shadow-[var(--shadow)] transition-transform duration-[var(--dur-press)] active:scale-95 lg:hidden"
        >
          <Plus className="size-6" aria-hidden />
        </button>
      )}

      {/* Phone bottom tabs: the spaces, the one that owns this screen lit. */}
      <nav
        aria-label={t('nav.main')}
        data-chrome-bar
        className="chrome-bottom glass fixed inset-x-0 bottom-0 z-40 grid border-t border-line px-[max(4px,env(safe-area-inset-left,0px))] pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom,0px))] lg:hidden"
        style={{ gridTemplateColumns: `repeat(${nav.spaces.length}, minmax(0, 1fr))` }}
      >
        {nav.spaces.map(spaceTab)}
      </nav>
    </div>
  );
}
