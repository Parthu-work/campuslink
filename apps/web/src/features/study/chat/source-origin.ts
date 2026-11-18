import { useTranslation } from '../../../i18n/react';
import { formatDuration } from '../../../lib/study';
import type { Cited } from './source-card';

/** Where a source sits: the page or moment of a study passage; for a career source, the caller's words. */
export function useStudyOrigin() {
  const { t } = useTranslation();
  return (c: Cited) =>
    'kind' in c
      ? ''
      : c.startSec !== null
        ? formatDuration(c.startSec)
        : c.page
          ? t('study.pageN', { n: c.page })
          : '';
}
