import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router';
import { cn } from '../../lib/cn';
import { useEdgeFade } from '../../lib/use-edge-fade';
import { prefersReducedMotion } from '../../lib/preferences';

/**
 * Route tabs (pill bar). The row scrolls with momentum and snap, fades at an edge with more tabs
 * beyond it, and keeps the active tab in view (audit DS-4, NB-4).
 */
export function TabNav({ label, tabs }: { label: string; tabs: readonly (readonly [string, string])[] }) {
  const { ref, fade } = useEdgeFade<HTMLDivElement>();
  const { pathname } = useLocation();
  useEffect(() => {
    const active = ref.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [pathname, ref]);
  return (
    <nav aria-label={label} className="rounded-full border border-line bg-surface-1 p-1">
      <div
        ref={ref}
        data-fade={fade}
        className="edge-fade flex snap-x gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map(([to, text]) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              cn(
                'flex min-h-11 flex-none snap-start items-center rounded-full px-4 text-sm font-semibold text-fg-2 hover:text-fg',
                isActive && 'bg-brand text-on-brand hover:text-on-brand',
              )
            }
          >
            {text}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/** In-page view switch (buttons with aria-pressed). */
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
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex gap-1 rounded-full border border-line bg-surface-1 p-1', className)}
    >
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          className="min-h-10 min-w-0 flex-1 rounded-full px-3 text-sm font-semibold text-fg-2 aria-pressed:bg-brand aria-pressed:text-on-brand"
        >
          {text}
        </button>
      ))}
    </div>
  );
}
