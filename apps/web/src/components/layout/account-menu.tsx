import { Link, NavLink } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { DropdownMenu } from 'radix-ui';
import { ChevronsUpDown, LogOut, Settings, User } from 'lucide-react';
import { useMe } from '../../lib/me';
import { useNav, type NavEntry } from '../../lib/nav';
import { useSignOut } from '../../lib/use-sign-out';
import { useUrlOverlay } from '../../lib/use-url-overlay';
import { cn } from '../../lib/cn';
import { Sheet } from '../ui/dialog';
import { PersonAvatar } from '../ui/person-avatar';

const itemClass =
  'flex min-h-11 items-center gap-3 rounded-[var(--radius-sm)] px-3 text-meta font-semibold text-fg-2 outline-none hover:bg-surface-2 hover:text-fg focus-visible:bg-surface-2 focus-visible:text-fg data-[highlighted]:bg-surface-2 data-[highlighted]:text-fg';

/** Desktop: the account button pinned to the bottom of the rail (profile, settings, sign out). */
export function AccountMenu({ platform }: { platform: boolean }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const signOut = useSignOut();
  if (!me) return null;
  const roles = me.roles.map((r) => t(`role.${r}`)).join(', ');
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-sm)] px-2 text-left hover:bg-surface-2 data-[state=open]:bg-surface-2"
        aria-label={t('nav.accountMenu', { name: me.name })}
        title={me.name}
      >
        <PersonAvatar name={me.name} fileId={null} size={36} />
        <span className="hidden min-w-0 flex-1 xl:block">
          <b className="block truncate text-meta">{me.name}</b>
          <span className="block truncate text-caption text-fg-3">{roles}</span>
        </span>
        <ChevronsUpDown className="hidden size-4 text-fg-3 xl:block" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[80] grid min-w-60 gap-0.5 rounded-[var(--radius-md)] border border-line-strong bg-surface-1 p-1.5 shadow-[var(--shadow)]"
        >
          <div className="px-3 py-2">
            <b className="block truncate text-meta">{me.name}</b>
            <span className="block truncate text-caption text-fg-3">{me.email}</span>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          {!platform && (
            <DropdownMenu.Item asChild>
              <Link to="/profile" className={itemClass}>
                <User className="size-5" aria-hidden /> {t('nav.profile')}
              </Link>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item asChild>
            <Link to="/settings" className={itemClass}>
              <Settings className="size-5" aria-hidden /> {t('nav.settings')}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item className={cn(itemClass, 'cursor-pointer')} onSelect={() => void signOut()}>
            <LogOut className="size-5" aria-hidden /> {t('common.signOut')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function SheetLink({ item, replace }: { item: NavEntry; replace: boolean }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={item.to}
      replace={replace}
      className={cn(itemClass, 'aria-[current=page]:bg-surface-2 aria-[current=page]:text-fg')}
    >
      <item.icon className="size-5" aria-hidden />
      <span className="flex-1">{item.label}</span>
      {item.badge > 0 && (
        <span className="grid min-w-5 place-items-center rounded-full bg-brand px-1.5 text-caption leading-5 font-semibold text-on-brand tabular-nums">
          {item.badge > 99 ? '99+' : item.badge}
          <span className="sr-only"> {t('nav.unread')}</span>
        </span>
      )}
    </NavLink>
  );
}

/** Phones: everything that is not a tab, behind the avatar in the top bar (decision D4). */
export function AccountSheet() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const nav = useNav();
  const signOut = useSignOut();
  const sheet = useUrlOverlay('sheet');
  if (!me) return null;
  const roles = me.roles.map((r) => t(`role.${r}`)).join(', ');
  return (
    <Sheet
      open={sheet.value === 'account'}
      onOpenChange={(o) => !o && sheet.close()}
      title={t('nav.account')}
      history={false}
    >
      <div className="flex items-center gap-3">
        <PersonAvatar name={me.name} fileId={null} size={48} />
        <div className="min-w-0">
          <b className="block truncate">{me.name}</b>
          <span className="block truncate text-meta text-fg-3">{roles}</span>
        </div>
      </div>
      <nav aria-label={t('nav.account')} className="grid gap-4">
        {nav.menu.map((g) => (
          <section key={g.group} className="grid gap-0.5">
            <h3 className="px-3 pb-1 text-caption font-semibold tracking-wide text-fg-3 uppercase">
              {g.label}
            </h3>
            {g.items.map((i) => (
              <SheetLink key={i.id} item={i} replace={sheet.replaceOnLeave} />
            ))}
          </section>
        ))}
        <button type="button" onClick={() => void signOut()} className={cn(itemClass, 'text-left')}>
          <LogOut className="size-5" aria-hidden /> {t('common.signOut')}
        </button>
      </nav>
    </Sheet>
  );
}
