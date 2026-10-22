import type { ReactElement, ReactNode } from 'react';
import { Tooltip as T } from 'radix-ui';

/**
 * A short hint on hover and keyboard focus (Radix: Escape closes it, it never traps focus). Never
 * the only place information lives: icon buttons still carry an aria-label.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode;
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  return (
    <T.Provider delayDuration={300} skipDelayDuration={200}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content
            side={side}
            sideOffset={6}
            className="tooltip-in z-[95] max-w-[260px] rounded-[var(--radius-sm)] border border-line-strong bg-surface-3 px-2.5 py-1.5 text-caption font-medium text-fg shadow-elev-2"
          >
            {content}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
