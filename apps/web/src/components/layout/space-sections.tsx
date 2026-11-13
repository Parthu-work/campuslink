import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useTranslation } from '../../i18n/react';
import type { SectionRef } from '@campuslink/shared';
import type { SpaceEntry } from '../../lib/nav';
import { intentPreload } from '../../lib/preload';
import { revealInRow } from '../../lib/reveal-in-row';

/**
 * The open space's sections as a row under the phone's top bar (prompt 3, U2): everything in the
 * space is one tap from its tab. The row scrolls sideways when the sections do not fit and keeps
 * the current one in view; the current section comes from the navigation model, so a screen deep
 * in a section still marks it.
 */
export function SpaceSections({ space, current }: { space: SpaceEntry; current: SectionRef | null }) {
  const { t } = useTranslation();
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = row.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (row.current && active) revealInRow(row.current, active, 'center');
  }, [current, space.id]);
  return (
    <nav
      aria-label={t('nav.sectionsOf', { space: space.label })}
      className="rounded-full border border-line bg-surface-1 p-1"
    >
      <div
        ref={row}
        className="relative flex snap-x gap-1 overflow-x-auto overscroll-x-contain [contain:inline-size] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {space.sections.map((x) => (
          <Link
            key={x.key}
            to={x.to}
            aria-current={x.key === current ? 'page' : undefined}
            {...intentPreload(x.to)}
            className="flex min-h-11 flex-none snap-start items-center gap-1.5 rounded-full px-4 text-callout font-semibold whitespace-nowrap text-fg-2 transition-colors duration-[var(--dur-press)] hover:text-fg aria-[current=page]:bg-brand aria-[current=page]:text-on-brand"
          >
            {x.label}
            {x.badge > 0 && (
              <span className="grid min-w-5 place-items-center rounded-full bg-surface-1 px-1.5 text-caption leading-5 font-semibold text-fg tabular-nums">
                {x.badge > 99 ? '99+' : x.badge}
                <span className="sr-only"> {t('nav.unread')}</span>
              </span>
            )}
          </Link>
        ))}
      </div>
    </nav>
  );
}
