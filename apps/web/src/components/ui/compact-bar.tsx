import { useEffect, useState, type ReactNode, type RefObject } from 'react';

/**
 * PageHeader's phone title bar (ADR 0015), loaded after the screen: it shows only while the screen
 * title is scrolled away and the app bar has hidden itself (`.compact-bar` in index.css), so the
 * two bars never overlap. Fixed, so loading it later never moves the page.
 */
export function CompactBar({
  heading,
  title,
  primary,
}: {
  heading: RefObject<HTMLElement | null>;
  title: ReactNode;
  primary?: ReactNode;
}) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = heading.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) =>
      setOn(!!e && !e.isIntersecting && e.boundingClientRect.top < 0),
    );
    io.observe(el);
    return () => io.disconnect();
  }, [heading]);
  return (
    <div
      aria-hidden={!on}
      inert={!on}
      data-compact={on ? 'on' : 'off'}
      className="compact-bar gutter glass fixed inset-x-0 top-0 z-[41] flex min-h-14 items-center gap-3 border-b border-line pt-[env(safe-area-inset-top,0px)] lg:hidden"
    >
      {/* Empty while hidden, so the title and its action exist once on the page. */}
      {on && (
        <>
          <span className="line-clamp-2 min-w-0 flex-1 text-callout font-semibold">{title}</span>
          {primary}
        </>
      )}
    </div>
  );
}
