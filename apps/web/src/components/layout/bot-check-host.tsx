import { useTranslation } from '../../i18n/react';
import { BOT_CHECK_HOST_ID } from '../../lib/bot-check-config';

/**
 * Where the human-check widget renders (lib/bot-check.ts). Hidden until a protected write needs a
 * token; most checks finish without any interaction, so it usually stays empty.
 */
export function BotCheckHost() {
  const { t } = useTranslation();
  return (
    <div
      id={BOT_CHECK_HOST_ID}
      hidden
      role="region"
      aria-label={t('botCheck.label')}
      className="fixed right-4 bottom-[calc(96px+env(safe-area-inset-bottom,0px))] z-[70] rounded-[var(--radius-md)] border border-line bg-surface-1 p-2 lg:bottom-4"
    />
  );
}
