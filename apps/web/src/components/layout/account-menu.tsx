import { Link } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { DropdownMenu } from 'radix-ui';
import { ChevronsUpDown, LifeBuoy, LogOut, Settings, User } from 'lucide-react';
import { useMe } from '../../lib/me';
import { useSignOut } from '../../lib/use-sign-out';
import { useUrlOverlay } from '../../lib/use-url-overlay';
import { cn } from '../../lib/cn';
import { Sheet } from '../ui/dialog';
import { PersonAvatar } from '../ui/person-avatar';

const itemClass =
  'flex min-h-11 items-center gap-3 rounded-[var(--radius-sm)] px-3 text-callout font-semibold text-fg-2 outline-none hover:bg-hover hover:text-fg focus-visible:bg-hover focus-visible:text-fg data-[highlighted]:bg-hover data-[highlighted]:text-fg';

/** Desktop: the account button at the foot of the sidebar (profile, settings, help, sign out). */
export function AccountMenu({ platform }: { platform: boolean }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const signOut = useSignOut();
  if (!me) return null;
  const roles = me.roles.map((r) => t(`role.${r}`)).join(', ');
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="flex min-h-12 w-full min-w-0 items-center gap-3 rounded-[var(--radius-sm)] px-2 text-left hover:bg-hover data-[state=open]:bg-hover"
        aria-label={t('nav.accountMenu', { name: me.name })}
        title={me.name}
      >
        <PersonAvatar name={me.name} fileId={null} size={36} />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-callout">{me.name}</b>
          <span className="block truncate text-caption text-fg-3">{roles}</span>
        </span>
        <ChevronsUpDown className="size-4 flex-none text-fg-3" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[80] grid min-w-60 gap-0.5 rounded-[var(--radius-md)] border border-line-strong bg-surface-1 p-1.5 shadow-[var(--shadow)]"
        >
          <div className="px-3 py-2">
            <b className="block truncate text-callout">{me.name}</b>
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
          {!platform && (
            <DropdownMenu.Item asChild>
              <Link to="/help" className={itemClass}>
                <LifeBuoy className="size-5" aria-hidden /> {t('nav.help')}
              </Link>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item className={cn(itemClass, 'cursor-pointer')} onSelect={() => void signOut()}>
            <LogOut className="size-5" aria-hidden /> {t('common.signOut')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Phones: the account behind the avatar in the top bar. Every destination now lives in one of the
 * five spaces (prompt 3, U2), so this is only what belongs to the person: their profile, settings,
 * help and the way out.
 */
export function AccountSheet() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const signOut = useSignOut();
  const sheet = useUrlOverlay('sheet');
  if (!me) return null;
  const roles = me.roles.map((r) => t(`role.${r}`)).join(', ');
  const links = [
    ['/profile', t('nav.profile'), User],
    ['/settings', t('nav.settings'), Settings],
    ['/help', t('nav.help'), LifeBuoy],
  ] as const;
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
          <b className="block [overflow-wrap:anywhere]">{me.name}</b>
          <span className="block text-callout text-fg-3">{roles}</span>
        </div>
      </div>
      <nav aria-label={t('nav.account')} className="grid gap-0.5">
        {links.map(([to, label, Icon]) => (
          <Link key={to} to={to} replace={sheet.replaceOnLeave} className={itemClass}>
            <Icon className="size-5" aria-hidden /> {label}
          </Link>
        ))}
        <button type="button" onClick={() => void signOut()} className={cn(itemClass, 'text-left')}>
          <LogOut className="size-5" aria-hidden /> {t('common.signOut')}
        </button>
      </nav>
    </Sheet>
  );
}
