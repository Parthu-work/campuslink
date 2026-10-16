import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Bell,
  Bookmark,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Compass,
  Film,
  HandHelping,
  HeartHandshake,
  Home,
  Inbox,
  LogOut,
  Menu,
  MessageCircleQuestion,
  MessagesSquare,
  Rss,
  Search,
  Settings,
  Shield,
  User,
  Users,
  type LucideIcon,
  Orbit,
} from 'lucide-react';
import type { Permission } from '@campuslink/shared';
import { Crest } from '../ui/misc';
import { useTenant } from '../../lib/tenant-context';
import { useMe } from '../../lib/me';
import { useSignOut } from '../../lib/use-sign-out';
import { cn } from '../../lib/cn';
import { usePalette, usePaletteShortcut } from '../../lib/palette';
import { CommandPalette } from './command-palette';
import { Dialog } from '../ui/dialog';
import { useRealtimeBridge } from '../../lib/use-realtime-bridge';
import { useUnreadMessages, useUnreadNotifications } from '../../lib/unread';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission | Permission[];
  /** Shown in the phone bottom bar (others live under "More"). */
  primary?: boolean;
  badge?: number;
}

function CountBadge({ n, label }: { n: number; label: string }) {
  if (!n) return null;
  return (
    <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-brand px-1.5 font-mono text-[11px] leading-5 font-semibold text-on-brand">
      {n > 99 ? '99+' : n}
      <span className="sr-only"> {label}</span>
    </span>
  );
}

function RealtimeBridge() {
  useRealtimeBridge();
  return null;
}

/** Desktop: rail + content (+ optional right rail). Phones: glass top bar + bottom nav. */
export function AppShell({ platform = false }: { platform?: boolean }) {
  const tenant = useTenant();
  const { t } = useTranslation();
  const { data: me } = useMe();
  const signOut = useSignOut();
  const openPalette = usePalette((s) => s.setOpen);
  usePaletteShortcut();
  const unreadMessages = useUnreadMessages(!platform);
  const unreadNotifications = useUnreadNotifications(!platform);
  const [more, setMore] = useState(false);
  const location = useLocation();
  const can = (p?: Permission | Permission[]) =>
    !p || (Array.isArray(p) ? p : [p]).some((x) => me?.permissions.includes(x));
  const adminHome = can('users:read_admin')
    ? '/admin'
    : can('mentorship:oversee')
      ? '/admin/mentorship'
      : can('moderation:act')
        ? '/admin/moderation'
        : '/admin/job-sources';
  const items: NavItem[] = platform
    ? [
        { to: '/platform', label: t('nav.platform'), icon: Building2 },
        { to: '/platform/health', label: t('nav.health'), icon: Activity },
        { to: '/settings', label: t('nav.settings'), icon: Settings },
      ]
    : [
        { to: '/home', label: t('nav.home'), icon: Home, primary: true },
        {
          to: '/jobs',
          label: t('nav.jobs'),
          icon: BriefcaseBusiness,
          permission: 'jobs:read',
          primary: true,
        },
        {
          to: '/roadmaps',
          label: t('nav.roadmaps'),
          icon: Orbit,
          permission: 'roadmaps:read',
          primary: true,
        },
        {
          to: '/mentors',
          label: t('nav.mentors'),
          icon: Compass,
          permission: 'mentorship:request',
          primary: true,
        },
        {
          to: '/sessions',
          label: t('nav.sessions'),
          icon: CalendarClock,
          permission: 'sessions:book',
          primary: true,
        },
        {
          to: '/messages',
          label: t('nav.messages'),
          icon: MessagesSquare,
          permission: 'messages:send',
          primary: true,
          badge: unreadMessages,
        },
        { to: '/questions', label: t('nav.questions'), icon: MessageCircleQuestion, permission: 'feed:read' },
        { to: '/reels', label: t('nav.reels'), icon: Film, permission: 'feed:read' },
        { to: '/people', label: t('nav.people'), icon: Users, permission: 'directory:read' },
        {
          to: '/referrals',
          label: t('nav.referrals'),
          icon: HandHelping,
          permission: ['referrals:request', 'referrals:offer'],
        },
        { to: '/mentorship', label: t('nav.requests'), icon: Inbox, permission: 'mentorship:request' },
        { to: '/mentor', label: t('nav.mentor'), icon: HeartHandshake, permission: 'mentorship:mentor' },
        { to: '/following', label: t('nav.following'), icon: Rss, permission: 'sources:follow' },
        { to: '/saved', label: t('nav.saved'), icon: Bookmark, permission: 'feed:interact' },
        { to: '/notifications', label: t('nav.notifications'), icon: Bell, badge: unreadNotifications },
        { to: '/profile', label: t('nav.profile'), icon: User },
        { to: '/settings', label: t('nav.settings'), icon: Settings },
        {
          to: adminHome,
          label: t('nav.admin'),
          icon: Shield,
          permission: [
            'users:read_admin',
            'mentorship:oversee',
            'moderation:act',
            'sources:manage',
            'jobs:sources',
          ],
        },
      ];
  const visible = items.filter((i) => can(i.permission));
  const bottom = platform ? visible : visible.filter((i) => i.primary).slice(0, 4);
  const overflow = platform ? [] : visible.filter((i) => !bottom.includes(i));
  const overflowBadge = overflow.reduce((n, i) => n + (i.badge ?? 0), 0);
  const link = (i: NavItem, compact: boolean) => (
    <NavLink
      key={i.to}
      to={i.to}
      end={i.to === '/platform'}
      className={({ isActive }) =>
        cn(
          'relative font-semibold text-fg-3 transition-colors hover:text-fg aria-[current=page]:text-fg',
          compact
            ? 'grid min-h-[52px] justify-items-center gap-0.5 rounded-[var(--radius-sm)] px-0.5 py-1.5 text-[11px]'
            : 'grid min-h-[46px] grid-cols-[24px_1fr] items-center gap-3 rounded-[var(--radius-sm)] px-3 text-sm hover:bg-surface-2 aria-[current=page]:bg-surface-2',
          isActive &&
            (compact
              ? 'before:absolute before:top-0 before:h-[3px] before:w-[22px] before:rounded-sm before:bg-brand'
              : 'before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-sm before:bg-brand'),
        )
      }
    >
      <i.icon className="size-5" aria-hidden />
      {compact ? (
        <span className="relative">
          {i.label}
          {!!i.badge && (
            <span className="absolute -top-7 left-[calc(50%+6px)] grid min-w-4 place-items-center rounded-full bg-brand px-1 font-mono text-[10px] leading-4 text-on-brand">
              {i.badge > 99 ? '99+' : i.badge}
              <span className="sr-only"> {t('nav.unread')}</span>
            </span>
          )}
        </span>
      ) : (
        <span className="flex items-center">
          {i.label}
          <CountBadge n={i.badge ?? 0} label={t('nav.unread')} />
        </span>
      )}
    </NavLink>
  );
  return (
    <div className="grid min-h-dvh lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-full focus:bg-surface-1 focus:px-4 focus:py-2"
      >
        {t('common.skipToContent')}
      </a>
      <nav
        aria-label={t('nav.main')}
        className="sticky top-0 hidden h-dvh flex-col gap-1.5 border-r border-line px-3.5 py-5 lg:flex"
      >
        <div className="flex items-center gap-2.5 px-2 pb-4">
          <Crest monogram={tenant.branding.monogram} />
          <b className="font-display text-[15px] leading-tight font-semibold">
            {tenant.branding.displayName}
          </b>
        </div>
        {visible.map((i) => link(i, false))}
        {!platform && (
          <button
            type="button"
            onClick={() => openPalette(true)}
            className="mt-3 flex min-h-11 items-center gap-2.5 rounded-[var(--radius-md)] border border-line bg-surface-1 px-3 text-sm text-fg-2 hover:text-fg"
          >
            <Search className="size-4" aria-hidden /> {t('palette.open')}
            <kbd className="ml-auto rounded-md border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-2">
              Ctrl K
            </kbd>
          </button>
        )}
        <div className="mt-auto grid gap-2 border-t border-line pt-3">
          {me && (
            <p className="truncate px-3 text-sm">
              <b className="block truncate">{me.name}</b>
              <span className="text-xs text-fg-3">{me.roles.map((r) => t(`role.${r}`)).join(', ')}</span>
            </p>
          )}
          <button
            type="button"
            onClick={signOut}
            className="grid min-h-[46px] grid-cols-[24px_1fr] items-center gap-3 rounded-[var(--radius-sm)] px-3 text-left text-sm font-semibold text-fg-3 hover:bg-surface-2 hover:text-fg"
          >
            <LogOut className="size-5" aria-hidden /> {t('common.signOut')}
          </button>
        </div>
      </nav>
      <header className="glass gutter fixed inset-x-0 top-0 z-40 flex items-center gap-2.5 border-b border-line pt-[calc(8px+env(safe-area-inset-top,0px))] pb-2 lg:hidden">
        <Crest monogram={tenant.branding.monogram} size={32} />
        <b className="font-display text-base font-semibold">{tenant.branding.shortName}</b>
        {!platform && (
          <>
            <button
              type="button"
              onClick={() => openPalette(true)}
              className="ml-auto grid size-11 place-items-center rounded-full text-fg-2 hover:bg-surface-2"
              aria-label={t('palette.open')}
            >
              <Search className="size-5" aria-hidden />
            </button>
            <Link
              to="/notifications"
              className="relative grid size-11 place-items-center rounded-full text-fg-2 hover:bg-surface-2"
              aria-label={
                unreadNotifications
                  ? t('nav.notificationsUnread', { count: unreadNotifications })
                  : t('nav.notifications')
              }
            >
              <Bell className="size-5" aria-hidden />
              {unreadNotifications > 0 && (
                <span
                  aria-hidden
                  className="absolute top-2 right-2 size-2.5 rounded-full bg-brand ring-2 ring-surface-1"
                />
              )}
            </Link>
          </>
        )}
        {platform && (
          <button
            type="button"
            onClick={signOut}
            className="ml-auto grid size-11 place-items-center rounded-full text-fg-2 hover:bg-surface-2"
            aria-label={t('common.signOut')}
          >
            <LogOut className="size-5" aria-hidden />
          </button>
        )}
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="gutter min-w-0 pt-[calc(64px+env(safe-area-inset-top,0px))] pb-[calc(96px+env(safe-area-inset-bottom,0px))] lg:py-8"
      >
        <div className="screen-in mx-auto grid max-w-[880px] gap-5">
          <Outlet />
        </div>
      </main>
      {!platform && <CommandPalette />}
      {!platform && <RealtimeBridge />}
      <nav
        aria-label={t('nav.main')}
        className="glass fixed inset-x-0 bottom-0 z-40 grid border-t border-line px-[max(8px,env(safe-area-inset-left,0px))] pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom,0px))] lg:hidden"
        style={{
          gridTemplateColumns: `repeat(${bottom.length + (overflow.length ? 1 : 0)}, minmax(0, 1fr))`,
        }}
      >
        {bottom.map((i) => link(i, true))}
        {overflow.length > 0 && (
          <button
            type="button"
            onClick={() => setMore(true)}
            aria-current={overflow.some((i) => location.pathname.startsWith(i.to)) ? 'page' : undefined}
            className="relative grid min-h-[52px] justify-items-center gap-0.5 rounded-[var(--radius-sm)] px-0.5 py-1.5 text-[11px] font-semibold text-fg-3 hover:text-fg aria-[current=page]:text-fg"
          >
            <Menu className="size-5" aria-hidden />
            <span className="relative">
              {t('nav.more')}
              {overflowBadge > 0 && (
                <span
                  aria-hidden
                  className="absolute -top-6 left-[calc(50%+6px)] size-2.5 rounded-full bg-brand"
                />
              )}
            </span>
          </button>
        )}
      </nav>
      {overflow.length > 0 && (
        <Dialog open={more} onOpenChange={setMore} title={t('nav.more')}>
          <nav aria-label={t('nav.more')} className="grid gap-1" onClick={() => setMore(false)}>
            {overflow.map((i) => link(i, false))}
            <button
              type="button"
              onClick={signOut}
              className="grid min-h-[46px] grid-cols-[24px_1fr] items-center gap-3 rounded-[var(--radius-sm)] px-3 text-left text-sm font-semibold text-fg-3 hover:bg-surface-2 hover:text-fg"
            >
              <LogOut className="size-5" aria-hidden /> {t('common.signOut')}
            </button>
          </nav>
        </Dialog>
      )}
    </div>
  );
}
