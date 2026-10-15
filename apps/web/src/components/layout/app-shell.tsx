import { NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Building2, Home, LogOut, Settings, Shield, Activity, type LucideIcon } from 'lucide-react';
import type { Permission } from '@campuslink/shared';
import { Crest } from '../ui/misc';
import { useTenant } from '../../lib/tenant-context';
import { useMe } from '../../lib/me';
import { useSignOut } from '../../lib/use-sign-out';
import { cn } from '../../lib/cn';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
}

/** Desktop: rail + content (+ optional right rail). Phones: glass top bar + bottom nav. */
export function AppShell({ platform = false }: { platform?: boolean }) {
  const tenant = useTenant();
  const { t } = useTranslation();
  const { data: me } = useMe();
  const signOut = useSignOut();
  const items: NavItem[] = platform
    ? [
        { to: '/platform', label: t('nav.platform'), icon: Building2 },
        { to: '/platform/health', label: t('nav.health'), icon: Activity },
        { to: '/settings', label: t('nav.settings'), icon: Settings },
      ]
    : [
        { to: '/home', label: t('nav.home'), icon: Home },
        { to: '/settings', label: t('nav.settings'), icon: Settings },
        { to: '/admin', label: t('nav.admin'), icon: Shield, permission: 'users:read_admin' },
      ];
  const visible = items.filter((i) => !i.permission || me?.permissions.includes(i.permission));
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
      <span>{i.label}</span>
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
        <button
          type="button"
          onClick={signOut}
          className="ml-auto grid size-11 place-items-center rounded-full text-fg-2 hover:bg-surface-2"
          aria-label={t('common.signOut')}
        >
          <LogOut className="size-5" aria-hidden />
        </button>
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
      <nav
        aria-label={t('nav.main')}
        className="glass fixed inset-x-0 bottom-0 z-40 grid border-t border-line px-[max(8px,env(safe-area-inset-left,0px))] pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom,0px))] lg:hidden"
        style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}
      >
        {visible.map((i) => link(i, true))}
      </nav>
    </div>
  );
}
