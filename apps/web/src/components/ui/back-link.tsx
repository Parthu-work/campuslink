import type { MouseEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/cn';

/** True when the previous history entry belongs to this app (React Router numbers its entries). */
const canGoBack = () => {
  const state = window.history.state as { idx?: number } | null;
  return typeof state?.idx === 'number' && state.idx > 0;
};

/**
 * "Back": returns to where the member came from, with their filters and scroll position, like the
 * browser's Back; opened from a link or a notification with no in-app history, it goes to the
 * parent screen instead (audit IA-4). It stays a real link to the parent.
 */
export function BackLink({
  to,
  children,
  className,
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  const navigate = useNavigate();
  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || !canGoBack()) return;
    e.preventDefault();
    void navigate(-1);
  };
  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded-full pr-3 text-meta font-semibold text-brand-ink hover:underline',
        className,
      )}
    >
      <ArrowLeft className="size-4" aria-hidden /> {children}
    </Link>
  );
}
