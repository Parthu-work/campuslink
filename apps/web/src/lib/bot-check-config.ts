import type { PublicBotCheck } from '@campuslink/shared';

/** Where the human check renders (`components/layout/bot-check-host.tsx`). */
export const BOT_CHECK_HOST_ID = 'bot-check-host';

let config: PublicBotCheck | null = null;
/** Set from the college config (`PublicTenant.botCheck`). */
export function setBotCheck(c: PublicBotCheck | null) {
  config = c;
}
export const botCheckEnabled = () => config !== null;
export const botCheckConfig = () => config;
