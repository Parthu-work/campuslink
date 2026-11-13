import { Navigate, useLocation } from 'react-router';
import type { AdminSectionId, NavId } from '@campuslink/shared';
import { LogOut } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { PageHeader } from '../../components/ui/page-header';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { ADMIN_ICONS } from '../../lib/admin-icons';
import { useMe } from '../../lib/me';
import { useNav } from '../../lib/nav';
import { NAV_ICONS } from '../../lib/nav-icons';
import { useSignOut } from '../../lib/use-sign-out';

/**
 * A space's own screen (prompt 3, U2): every section of the space as one list, so anything in it is
 * two taps from its tab. It is where You, Students, Content and College open; the other spaces open
 * on their first section and reach this list through "All in …".
 */
export function SpaceHubPage() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const nav = useNav();
  const { data: me } = useMe();
  const signOut = useSignOut();
  const space = nav.spaces.find((s) => s.browse === pathname.replace(/\/+$/, ''));
  // A space this member does not have (another role's link): their own first screen.
  if (!space) return <Navigate to={nav.landing} replace />;
  const you = space.id === 'you';
  return (
    <>
      <PageHeader title={space.label} size="display" />
      {you && me && (
        <div className="flex items-center gap-3">
          <PersonAvatar name={me.name} fileId={null} size={56} />
          <div className="grid min-w-0 gap-0.5">
            <p className="text-headline font-semibold [overflow-wrap:anywhere]">{me.name}</p>
            <p className="text-callout text-fg-2">{me.roles.map((r) => t(`role.${r}`)).join(', ')}</p>
          </div>
        </div>
      )}
      <ListSection>
        {space.sections.map((x) => {
          const Icon = x.key.startsWith('admin:')
            ? ADMIN_ICONS[x.key.slice(6) as AdminSectionId]
            : NAV_ICONS[x.key as NavId];
          return (
            <ListRow
              key={x.key}
              to={x.to}
              leading={<Icon aria-hidden />}
              title={x.label}
              meta={x.locked ? t('nav.locked') : undefined}
              trailing={
                x.badge > 0 ? (
                  <span className="grid min-w-5 place-items-center rounded-full bg-brand px-1.5 text-caption leading-5 font-semibold text-on-brand tabular-nums">
                    {x.badge > 99 ? '99+' : x.badge}
                    <span className="sr-only"> {t('nav.unread')}</span>
                  </span>
                ) : undefined
              }
              chevron
            />
          );
        })}
      </ListSection>
      {you && (
        <div>
          <Button variant="secondary" onClick={() => void signOut()}>
            <LogOut aria-hidden /> {t('common.signOut')}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Where a signed-in member starts (after sign-in, and when the app opens at its root): Career in
 * the final two years, Learn in the first, otherwise their first space.
 */
export function StartPage() {
  const nav = useNav();
  const { data: me } = useMe();
  // Their year decides it, so wait for the member: a moment of nothing, never a wrong first screen.
  if (!me) return null;
  return <Navigate to={nav.landing} replace />;
}
