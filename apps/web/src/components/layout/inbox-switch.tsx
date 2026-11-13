import { useTranslation } from '../../i18n/react';
import { useCan } from '../../lib/me';
import { TabNav } from '../ui/tab-nav';

/**
 * One inbox (prompt 3, U2): notifications and messages stay two screens, behind one entry in the
 * top bar with one unread count, and this switch at the top of both moves between them. A member
 * who cannot message sees only notifications, so there is nothing to switch.
 */
export function InboxSwitch() {
  const { t } = useTranslation();
  const canMessage = useCan('messages:send');
  if (!canMessage) return null;
  return (
    <TabNav
      label={t('nav.inbox')}
      tabs={[
        ['/notifications', t('nav.notifications')],
        ['/messages', t('nav.messages')],
      ]}
    />
  );
}
