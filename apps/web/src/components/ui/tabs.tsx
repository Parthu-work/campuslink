import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { useEdgeFade } from '../../lib/use-edge-fade';
import { prefersReducedMotion } from '../../lib/preferences';
import { useSlidingIndicator } from '../../lib/use-sliding-indicator';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** A count after the label (materials in a tab, unread items). */
  count?: number;
}

/**
 * In-page tabs (profile sections, Study's Notes / Slides / Videos / PYQs / Other): the WAI-ARIA tab
 * pattern with automatic activation, an underline that slides to the selected tab, and a row that
 * scrolls with edge fades when the labels don't fit. Pair each tab with a `TabPanel` sharing `idBase`.
 */
export function Tabs<T extends string>({
  label,
  idBase,
  value,
  tabs,
  onChange,
  className,
}: {
  label: string;
  idBase: string;
  value: T;
  tabs: readonly TabItem<T>[];
  onChange: (id: T) => void;
  className?: string;
}) {
  const { ref, fade } = useEdgeFade<HTMLDivElement>();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const indicator = useSlidingIndicator(ref, '[aria-selected="true"]', value);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [value, ref]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    const to =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? tabs.length - 1
          : step === undefined
            ? -1
            : (i + step + tabs.length) % tabs.length;
    const tab = tabs[to];
    if (!tab) return;
    e.preventDefault();
    onChange(tab.id);
    refs.current[to]?.focus();
  };

  return (
    <div className={cn('border-b border-line', className)}>
      <div
        ref={ref}
        role="tablist"
        aria-label={label}
        data-fade={fade}
        className="edge-fade relative flex gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <span
          aria-hidden
          className="sliding-indicator pointer-events-none absolute bottom-0 left-0 h-[3px] rounded-full bg-brand"
          style={indicator}
        />
        {tabs.map((tab, i) => {
          const selected = tab.id === value;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${idBase}-tab-${tab.id}`}
              aria-controls={selected ? `${idBase}-panel-${tab.id}` : undefined}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(e) => onKey(e, i)}
              className="relative flex min-h-12 flex-none items-center gap-2 px-3 text-meta font-semibold whitespace-nowrap text-fg-2 transition-colors duration-[var(--dur-fast)] hover:text-fg aria-selected:text-fg"
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="rounded-full bg-surface-2 px-1.5 text-caption leading-5 text-fg-2 tabular-nums">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The panel for one tab; render only the selected one (or keep others `hidden`). */
export function TabPanel({
  idBase,
  id,
  children,
  className,
}: {
  idBase: string;
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${id}`}
      aria-labelledby={`${idBase}-tab-${id}`}
      tabIndex={0}
      className={cn('focus-visible:outline-offset-4', className)}
    >
      {children}
    </div>
  );
}
