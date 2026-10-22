import { forwardRef, useEffect, useRef, type ComponentProps } from 'react';
import { Link } from 'react-router';
import { intentPreload, preloadPath } from '../../lib/preload';

type Props = ComponentProps<typeof Link> & { to: string };

/**
 * A link to a detail screen that gets it ready ahead of the tap: its code once the link scrolls
 * into view, and its code and data on hover, focus or touch (audit PF-2). Data is not fetched for
 * every visible card, to spare members on metered connections.
 */
export const IntentLink = forwardRef<HTMLAnchorElement, Props>(({ to, ...props }, forwarded) => {
  const local = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    const el = local.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          preloadPath(to, { data: false });
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [to]);
  return (
    <Link
      ref={(el) => {
        local.current = el;
        if (typeof forwarded === 'function') forwarded(el);
        else if (forwarded) forwarded.current = el;
      }}
      to={to}
      {...intentPreload(to)}
      {...props}
    />
  );
});
IntentLink.displayName = 'IntentLink';
