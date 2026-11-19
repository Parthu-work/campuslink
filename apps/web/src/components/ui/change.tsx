import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * The change under a headline number (prompt 3, U9c): an arrow and the words, so it never relies
 * on colour. `better` says which way is good and only sets the colour. A null `delta` (no earlier
 * figure, or one under 5) is a quiet line of text. Goes in a `StatCard`'s `hint`.
 */
export function Change({
  delta,
  text,
  better = 'up',
}: {
  delta: number | null;
  text: string;
  better?: 'up' | 'down';
}) {
  if (delta === null) return <span className="text-fg-3">{text}</span>;
  const Icon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
  const good = delta === 0 ? null : delta > 0 === (better === 'up');
  return (
    <span
      className={cn(
        'inline-flex items-start gap-1 font-semibold',
        good === null ? 'text-fg-2' : good ? 'text-success-ink' : 'text-danger-ink',
      )}
    >
      <Icon className="mt-px size-3.5 flex-none" aria-hidden />
      <span>{text}</span>
    </span>
  );
}
