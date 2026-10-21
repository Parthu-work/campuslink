import { useNavigation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '../ui/misc';

/**
 * The content-area placeholder while a screen's code loads for the first time. It fades in only
 * after 200 ms, so fast loads never flash it, and it sits inside the shell (never full screen).
 */
export function PageSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="delayed-in grid gap-4" role="status" aria-live="polite">
      <span className="sr-only">{t('common.loading')}</span>
      <Skeleton className="h-9 w-2/3 max-w-80" />
      <Skeleton className="h-5 w-full max-w-[52ch]" />
      <div className="grid gap-3 pt-2">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    </div>
  );
}

/** Signed-in boot (loading `/me`): the shell's outline, so the real shell replaces it in place. */
export function ShellSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[76px_minmax(0,1fr)] xl:grid-cols-[256px_minmax(0,1fr)]">
      <div aria-hidden className="hidden border-r border-line lg:block" />
      <div
        aria-hidden
        className="fixed inset-x-0 top-0 h-[calc(60px+env(safe-area-inset-top,0px))] border-b border-line bg-surface-1 lg:hidden"
      />
      <div className="gutter pt-[calc(76px+env(safe-area-inset-top,0px))] lg:py-8">
        <div className="mx-auto max-w-[880px]">
          <PageSkeleton />
        </div>
      </div>
      <div
        aria-hidden
        className="fixed inset-x-0 bottom-0 h-[calc(64px+env(safe-area-inset-bottom,0px))] border-t border-line bg-surface-1 lg:hidden"
      />
      <span className="sr-only" role="status">
        {t('common.loading')}
      </span>
    </div>
  );
}

/** A thin bar at the top while a navigation waits for code or data (after 150 ms, never a spinner). */
export function NavProgress() {
  const navigation = useNavigation();
  if (navigation.state === 'idle') return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[90] h-[3px] overflow-hidden">
      <div className="nav-progress h-full w-full origin-left bg-[linear-gradient(90deg,var(--brand),var(--accent))]" />
    </div>
  );
}
