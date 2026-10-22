import { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useEdgeFade } from '../../lib/use-edge-fade';
import { prefersReducedMotion } from '../../lib/preferences';
import { useSlidingIndicator } from '../../lib/use-sliding-indicator';

/**
 * Route tabs (pill bar). The row scrolls with momentum and snap, fades at an edge with more tabs
 * beyond it, and keeps the active tab in view (audit DS-4, NB-4).
 */
export function TabNav({ label, tabs }: { label: string; tabs: readonly (readonly [string, string])[] }) {
  const { ref, fade } = useEdgeFade<HTMLDivElement>();
  const { pathname } = useLocation();
  const indicator = useSlidingIndicator(ref, '[aria-current="page"]', pathname);
  const scrollRow = (dir: 1 | -1) =>
    ref.current?.scrollBy({
      left: dir * ref.current.clientWidth * 0.7,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  useEffect(() => {
    const active = ref.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [pathname, ref]);
  return (
    <nav aria-label={label} className="group/row relative rounded-full border border-line bg-surface-1 p-1">
      <div
        ref={ref}
        data-fade={fade}
        className="edge-fade relative flex snap-x gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <span
          aria-hidden
          className="sliding-indicator pointer-events-none absolute inset-y-0 left-0 rounded-full bg-brand"
          style={indicator}
        />
        {tabs.map(([to, text]) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              cn(
                'relative flex min-h-11 flex-none snap-start items-center rounded-full px-4 text-sm font-semibold text-fg-2 transition-colors duration-[var(--dur-fast)] hover:text-fg',
                isActive && 'text-on-brand hover:text-on-brand',
              )
            }
          >
            {text}
          </NavLink>
        ))}
      </div>
      {/* Pointer devices get arrows on hover; touch scrolls with momentum. Hidden from AT: the
          tabs themselves are all reachable with Tab. */}
      {(['start', 'end'] as const).map((side) =>
        fade === side || fade === 'both' ? (
          <button
            key={side}
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => scrollRow(side === 'start' ? -1 : 1)}
            className={cn(
              'absolute top-1/2 hidden size-8 -translate-y-1/2 place-items-center rounded-full border border-line-strong bg-surface-1 text-fg-2 opacity-0 shadow-[var(--shadow)] transition-opacity group-hover/row:opacity-100 hover:text-fg [@media(hover:hover)]:grid',
              side === 'start' ? 'left-1' : 'right-1',
            )}
          >
            {side === 'start' ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : null,
      )}
    </nav>
  );
}

/**
 * In-page view switch (buttons with aria-pressed). A highlight slides to the chosen option; when the
 * options don't fit (Telugu, four options on a phone) the row scrolls instead of wrapping (DS-4).
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const indicator = useSlidingIndicator(row, '[aria-pressed="true"]', value);
  return (
    <div
      ref={row}
      role="group"
      aria-label={label}
      className={cn(
        'relative flex gap-1 overflow-x-auto rounded-full border border-line bg-surface-1 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      <span
        aria-hidden
        className="sliding-indicator pointer-events-none absolute inset-y-1 left-0 rounded-full bg-brand"
        style={indicator}
      />
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          className="relative min-h-11 flex-1 rounded-full px-3 text-sm font-semibold whitespace-nowrap text-fg-2 transition-colors duration-[var(--dur-fast)] hover:text-fg aria-pressed:text-on-brand"
        >
          {text}
        </button>
      ))}
    </div>
  );
}
