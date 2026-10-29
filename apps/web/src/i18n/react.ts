import { useMemo, useSyncExternalStore } from 'react';
import i18n, { type TFunction } from './core';

const subscribe = (onChange: () => void) => {
  i18n.on('languageChanged', onChange);
  return () => i18n.off('languageChanged', onChange);
};
const current = () => i18n.language;

/**
 * Strings for the member's language. Components re-render when it changes, and `t` is a new
 * function per language, so memos that list it as a dependency recompute.
 */
export function useTranslation(): { t: TFunction; i18n: typeof i18n } {
  const lng = useSyncExternalStore(subscribe, current, current);
  return useMemo(() => {
    const t: TFunction = (key, options) => i18n.t(key, options);
    return { t, i18n, lng };
  }, [lng]);
}
