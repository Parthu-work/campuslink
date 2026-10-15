import { NavLink } from 'react-router';
import { cn } from '../../lib/cn';

/** Route tabs (pill bar). */
export function TabNav({ label, tabs }: { label: string; tabs: readonly (readonly [string, string])[] }) {
  return (
    <nav
      aria-label={label}
      className="flex gap-1 overflow-x-auto rounded-full border border-line bg-surface-1 p-1"
    >
      {tabs.map(([to, text]) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            cn(
              'min-h-10 flex-none rounded-full px-4 py-2 text-sm font-semibold text-fg-2',
              isActive && 'bg-brand text-on-brand',
            )
          }
        >
          {text}
        </NavLink>
      ))}
    </nav>
  );
}

/** In-page view switch (buttons with aria-pressed). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-1 rounded-full border border-line bg-surface-1 p-1"
    >
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          className="min-h-10 flex-1 rounded-full px-4 text-sm font-semibold text-fg-2 aria-pressed:bg-brand aria-pressed:text-on-brand"
        >
          {text}
        </button>
      ))}
    </div>
  );
}
