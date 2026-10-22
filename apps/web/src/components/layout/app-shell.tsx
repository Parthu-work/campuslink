import { useEffect, useMemo, type MouseEvent } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, LogOut, MessagesSquare, Plus, Search } from 'lucide-react';
import { Crest } from '../ui/misc';
import { PersonAvatar } from '../ui/person-avatar';
import { useTenant } from '../../lib/tenant-context';
import { useMe } from '../../lib/me';
import { useSignOut } from '../../lib/use-sign-out';
import { useRouteFocus } from '../../lib/route-focus';
import { useScrollMemory } from '../../lib/scroll-memory';
import { useScrollChrome } from '../../lib/use-scroll-chrome';
import { useTabMemory } from '../../lib/tab-memory';
import { intentPreload, preloadWhenIdle } from '../../lib/preload';
import { cn } from '../../lib/cn';
import { formatDay } from '../../lib/format';
import { paletteShortcut, useNav, type NavEntry } from '../../lib/nav';
import { usePalette, usePaletteShortcut } from '../../lib/palette';
import { useUrlOverlay } from '../../lib/use-url-overlay';
import { useRealtimeBridge } from '../../lib/use-realtime-bridge';
import { prefersReducedMotion } from '../../lib/preferences';
import { NavProgress } from './skeletons';
import { useIdle } from '../../lib/use-idle';
import { lazyPart } from '../../lib/lazy-part';

// Not needed for the first screen (audit PF-1): the palette (cmdk), the account menu (Radix menu)
// and the sheets load after the first idle period, or at once when the member opens them.
// A part that cannot load (offline) keeps its placeholder and retries when the connection returns.
const CommandPalette = lazyPart(() => import('./command-palette').then((m) => m.CommandPalette));
const AccountMenu = lazyPart(() => import('./account-menu').then((m) => m.AccountMenu));
const AccountSheet = lazyPart(() => import('./account-menu').then((m) => m.AccountSheet));
const CreateSheet = lazyPart(() => import('./create-sheet').then((m) => m.CreateSheet));

/** Same size as the account button, while the menu's code loads (no layout shift). */
function AccountButtonPlaceholder({ name }: { name: string }) {
  return (
    <div aria-hidden className="flex min-h-12 items-center gap-3 px-2">
      <PersonAvatar name={name || '?'} fileId={null} size={36} />
      <span className="hidden truncate text-sm font-bold xl:block">{name}</span>
    </div>
  );
}

function RealtimeBridge() {
  useRealtimeBridge();
  return null;
}

function Count({ n, className }: { n: number; className?: string }) {
  const { t } = useTranslation();
  if (!n) return null;
  return (
    <span
      className={cn(
        'grid min-w-5 place-items-center rounded-full bg-brand px-1.5 text-xs leading-5 font-semibold text-on-brand tabular-nums',
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

/**
 * The persistent signed-in shell: it never unmounts on navigation. Desktop gets a rail that scrolls
 * on its own (icons only below 1280 px) with the account menu pinned at its foot; phones get a top
 * bar (search, messages, notifications, avatar) and role-aware bottom tabs with a centre Create.
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
  useRouteFocus(tenant.branding.shortName);
  const tabRoots = useMemo(() => new Set(nav.tabs.map((i) => i.to)), [nav.tabs]);
  useScrollMemory(tabRoots);
  useScrollChrome();
  // Every tab's code is ready before the first tap (audit TR-1, TR-2).
  useEffect(() => preloadWhenIdle([...tabRoots]), [tabRoots]);

  const tabs = nav.tabs.filter((i) => i.id !== 'create');
  const tabMemory = useTabMemory(tabs);
  const canCreate = nav.create.length > 0;

  const railLink = (i: NavEntry) => (
    <NavLink
      key={i.id}
      to={i.to}
      end={i.to === '/platform'}
      title={i.label}
      onClick={reselect(i.to)}
      {...intentPreload(i.to)}
      className="group relative grid min-h-11 grid-cols-[24px] place-content-center items-center gap-3 rounded-[var(--radius-sm)] px-3 text-sm font-semibold text-fg-3 hover:bg-surface-2 hover:text-fg aria-[current=page]:bg-surface-2 aria-[current=page]:text-fg xl:grid-cols-[24px_1fr] xl:place-content-stretch"
    >
      <span className="relative">
        <i.icon className="size-5" aria-hidden />
        {i.badge > 0 && (
          <span
            aria-hidden
            className="absolute -top-1 -right-1 size-2.5 rounded-full bg-brand ring-2 ring-bg xl:hidden"
          />
        )}
      </span>
      <span className="sr-only xl:not-sr-only xl:flex xl:items-center">
        {i.label}
        <Count n={i.badge} className="ml-auto hidden xl:grid" />
      </span>
      <span
        aria-hidden
        className="absolute inset-y-2.5 left-0 hidden w-[3px] rounded-sm bg-brand group-aria-[current=page]:block"
      />
    </NavLink>
  );

  const tabLink = (i: NavEntry) => {
    const to = tabMemory.hrefFor(i);
    const lit = tabMemory.active === i.id;
    return (
      <Link
        key={i.id}
        to={to}
        aria-current={lit ? 'page' : undefined}
        onClick={reselect(to)}
        {...intentPreload(to)}
        className="group relative grid min-h-[52px] justify-items-center gap-0.5 rounded-[var(--radius-sm)] px-0.5 py-1.5 text-xs font-semibold text-fg-3 hover:text-fg aria-[current=page]:text-fg"
      >
        <span
          aria-hidden
          className="absolute top-0 hidden h-[3px] w-[22px] rounded-sm bg-brand group-aria-[current=page]:block"
        />
        <i.icon className="size-5" aria-hidden />
        <span className="max-w-full truncate">{i.label}</span>
        {i.badge > 0 && (
          <span className="absolute top-0.5 left-[calc(50%+4px)]">
            <Count n={i.badge} className="min-w-4 px-1 text-[10px] leading-4" />
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[76px_minmax(0,1fr)] xl:grid-cols-[256px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-full focus:bg-surface-1 focus:px-4 focus:py-2"
      >
        {t('common.skipToContent')}
      </a>
      <NavProgress />

      {/* Desktop rail: its own scroll area, account menu always visible at the foot. */}
      <nav
        aria-label={t('nav.main')}
        className="app-rail sticky top-0 hidden h-dvh min-h-0 flex-col border-r border-line lg:flex"
      >
        <Link
          to={platform ? '/platform' : '/home'}
          className="flex items-center justify-center gap-2.5 px-3.5 pt-5 pb-4 xl:justify-start"
          title={tenant.branding.displayName}
        >
          <Crest monogram={tenant.branding.monogram} />
          <b className="hidden font-display text-[15px] leading-tight font-semibold xl:block">
            {tenant.branding.displayName}
          </b>
          <span className="sr-only xl:hidden">{tenant.branding.displayName}</span>
        </Link>
        <div className="grid min-h-0 flex-1 content-start gap-1 overflow-y-auto overscroll-contain px-3 pb-4">
          {canCreate && (
            <button
              type="button"
              onClick={() => sheet.open('create')}
              title={t('nav.create')}
              className="mb-2 flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-on-brand hover:brightness-110 xl:justify-start"
            >
              <Plus className="size-5" aria-hidden />
              <span className="sr-only xl:not-sr-only">{t('nav.create')}</span>
            </button>
          )}
          {tabs.map(railLink)}
          {!platform && (
            <button
              type="button"
              onClick={() => openPalette(true)}
              title={t('palette.open')}
              className="my-2 flex min-h-11 items-center justify-center gap-2.5 rounded-[var(--radius-md)] border border-line bg-surface-1 px-3 text-sm text-fg-2 hover:text-fg xl:justify-start"
            >
              <Search className="size-4" aria-hidden />
              <span className="sr-only xl:not-sr-only">{t('palette.open')}</span>
              <kbd className="ml-auto hidden rounded-md border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg-2 xl:inline">
                {paletteShortcut()}
              </kbd>
            </button>
          )}
          {nav.menu.map((g) => (
            <section key={g.group} aria-label={g.label} className="grid gap-1 pt-2">
              <h2 className="hidden px-3 pb-0.5 text-xs font-semibold tracking-wide text-fg-3 uppercase xl:block">
                {g.label}
              </h2>
              <div aria-hidden className="mx-3 mb-1 h-px bg-line xl:hidden" />
              {g.items.map(railLink)}
            </section>
          ))}
        </div>
        <div className="border-t border-line p-3">
          <AccountMenu platform={platform} fallback={<AccountButtonPlaceholder name={me?.name ?? ''} />} />
        </div>
      </nav>

      {/* Phone top bar. */}
      <header
        data-chrome-bar
        className="chrome-top gutter fixed inset-x-0 top-0 z-40 flex items-center gap-1 border-b pt-[calc(8px+env(safe-area-inset-top,0px))] pb-2 lg:hidden"
      >
        <Link to={platform ? '/platform' : '/home'} className="flex min-w-0 items-center gap-2.5 pr-2">
          <Crest monogram={tenant.branding.monogram} size={32} />
          <b className="truncate font-display text-base font-semibold">{tenant.branding.shortName}</b>
        </Link>
        <div className="ml-auto flex items-center">
          {!platform && (
            <button
              type="button"
              onClick={() => openPalette(true)}
              className="grid size-11 place-items-center rounded-full text-fg-2 hover:bg-surface-2"
              aria-label={t('palette.open')}
            >
              <Search className="size-5" aria-hidden />
            </button>
          )}
          {!platform && nav.canMessage && (
            <Link
              to="/messages"
              className="relative grid size-11 place-items-center rounded-full text-fg-2 hover:bg-surface-2"
              aria-label={
                nav.unreadMessages
                  ? t('nav.messagesUnread', { count: nav.unreadMessages })
                  : t('nav.messages')
              }
            >
              <MessagesSquare className="size-5" aria-hidden />
              {nav.unreadMessages > 0 && (
                <span aria-hidden className="absolute top-1 right-0.5">
                  <Count n={nav.unreadMessages} className="min-w-4 px-1 text-[10px] leading-4" />
                </span>
              )}
            </Link>
          )}
          {!platform && (
            <Link
              to="/notifications"
              className="relative grid size-11 place-items-center rounded-full text-fg-2 hover:bg-surface-2"
              aria-label={
                nav.unreadNotifications
                  ? t('nav.notificationsUnread', { count: nav.unreadNotifications })
                  : t('nav.notifications')
              }
            >
              <Bell className="size-5" aria-hidden />
              {nav.unreadNotifications > 0 && (
                <span aria-hidden className="absolute top-1 right-0.5">
                  <Count n={nav.unreadNotifications} className="min-w-4 px-1 text-[10px] leading-4" />
                </span>
              )}
            </Link>
          )}
          {platform ? (
            <button
              type="button"
              onClick={() => void signOut()}
              className="grid size-11 place-items-center rounded-full text-fg-2 hover:bg-surface-2"
              aria-label={t('common.signOut')}
            >
              <LogOut className="size-5" aria-hidden />
            </button>
          ) : (
            me && (
              <button
                type="button"
                onClick={() => sheet.open('account')}
                className="grid size-11 place-items-center rounded-full hover:bg-surface-2"
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
              className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-danger bg-surface-1 p-3 text-sm"
            >
              <span>{t('settings.data.banner', { date: formatDay(me.deletionPurgeAt) })}</span>
              <Link to="/settings/data" className="font-semibold text-brand-ink underline">
                {t('settings.data.cancel')}
              </Link>
            </div>
          )}
          <Outlet />
        </div>
      </main>

      {!platform && <RealtimeBridge />}
      {!platform && (idle || paletteOpen) && <CommandPalette />}
      {!platform && (idle || sheet.value === 'account') && <AccountSheet />}
      {canCreate && (idle || sheet.value === 'create') && <CreateSheet />}

      {/* Phone bottom tabs: role-aware, Create in the middle. */}
      <nav
        aria-label={t('nav.main')}
        data-chrome-bar
        className="chrome-bottom glass fixed inset-x-0 bottom-0 z-40 grid border-t border-line px-[max(8px,env(safe-area-inset-left,0px))] pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom,0px))] lg:hidden"
        style={{ gridTemplateColumns: `repeat(${nav.tabs.length}, minmax(0, 1fr))` }}
      >
        {nav.tabs.map((i) =>
          i.id === 'create' ? (
            <div key="create" className="grid place-items-center">
              <button
                type="button"
                onClick={() => sheet.open('create')}
                aria-label={t('nav.create')}
                aria-haspopup="dialog"
                className="grid size-12 place-items-center rounded-full bg-brand text-on-brand shadow-[var(--shadow)] transition-transform active:scale-95"
              >
                <Plus className="size-6" aria-hidden />
              </button>
            </div>
          ) : (
            tabLink(i)
          ),
        )}
      </nav>
    </div>
  );
}
