import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * A long form's actions, always within reach (audit FO-2): on phones a bar fixed just above the tab
 * bar that slides down with it when the bars hide (transform only, `.form-footer` in index.css),
 * with a spacer so the last field never sits under it; on desktop it sticks to the bottom of the
 * content column. Put the primary action last.
 */
export function FormFooter({
  children,
  desktop = 'sticky',
  className,
}: {
  children: ReactNode;
  /** `inline`: on desktop the actions sit where they are (a side panel that already sticks). */
  desktop?: 'sticky' | 'inline';
  className?: string;
}) {
  return (
    <>
      <div className="h-20 lg:hidden" aria-hidden />
      <div
        className={cn(
          'form-footer fixed inset-x-0 z-30 border-t border-line bg-surface-1 px-[max(16px,env(safe-area-inset-left,0px))] py-3',
          desktop === 'sticky'
            ? 'lg:sticky lg:inset-x-auto lg:rounded-[var(--radius-lg)] lg:border lg:px-4 lg:shadow-elev-2'
            : 'lg:static lg:border-0 lg:bg-transparent lg:p-0',
          className,
        )}
      >
        <div
          className={cn(
            'flex flex-wrap items-center justify-end gap-2',
            desktop === 'inline' && 'lg:justify-start',
          )}
        >
          {children}
        </div>
      </div>
    </>
  );
}
