import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * The top of a screen: one h1 (focused after navigation), an optional icon and intro, and the
 * screen's actions. Replaces the 30 hand-pasted headers (audit DS-1). `size="display"` is for the
 * hero screens (Home, Profile, Galaxy, Events, Study).
 */
export function PageHeader({
  title,
  icon,
  intro,
  eyebrow,
  actions,
  size = 'headline',
  as: Root = 'header',
  level = 1,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  intro?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  size?: 'headline' | 'display';
  /** `div` inside a detail page's own `<header>` (headers don't nest). */
  as?: 'header' | 'div';
  /** 2 only where the header is a specimen inside another page (the style guide). */
  level?: 1 | 2;
  className?: string;
}) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <Root className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}>
      <div className="grid min-w-0 flex-[1_1_20rem] gap-1.5">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <Heading
          className={cn(
            'flex min-w-0 items-center gap-2.5 font-bold',
            size === 'display' ? 'text-display' : 'text-headline',
          )}
        >
          {icon && (
            <span className="flex-none text-brand-ink [&_svg]:size-[0.95em]" aria-hidden>
              {icon}
            </span>
          )}
          <span className="min-w-0">{title}</span>
        </Heading>
        {intro && <p className="max-w-[62ch] text-fg-2">{intro}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </Root>
  );
}
