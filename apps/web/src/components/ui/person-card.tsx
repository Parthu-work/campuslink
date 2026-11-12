import type { ReactNode } from 'react';
import { PersonAvatar } from './person-avatar';
import { IntentLink } from './intent-link';
import { Badge } from './misc';
import { cn } from '../../lib/cn';

/**
 * A person (ADR 0015: alumni are the product): their face or initials, name, one "role at company"
 * line, batch, one reason they are shown, and one action. Used by mentors, alumni, suggestions and
 * the network. Names and roles wrap; nothing is truncated (X5). `demo` marks demo people once.
 */
export function PersonCard({
  name,
  photoId,
  role,
  batch,
  reason,
  to,
  action,
  demo,
  verified,
  layout = 'stack',
  demoLabel,
  className,
}: {
  name: string;
  photoId?: string | null;
  /** "Data Analyst at Kestrel Analytics": one line, said once. */
  role?: ReactNode;
  /** "Batch of 2021 · CSE". */
  batch?: ReactNode;
  /** Why this person: "Same branch, works where you want to". */
  reason?: ReactNode;
  /** Their profile. */
  to?: string;
  /** One action (Follow, Request), at secondary weight. */
  action?: ReactNode;
  demo?: boolean;
  /** `t('common.demo')` when `demo`. */
  demoLabel?: string;
  verified?: boolean;
  /** `stack` for a row of cards, `row` for a list. */
  layout?: 'stack' | 'row';
  className?: string;
}) {
  const nameEl = to ? (
    <IntentLink
      to={to}
      className="font-semibold text-fg outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-[var(--focus-ring)]"
    >
      {name}
    </IntentLink>
  ) : (
    <span className="font-semibold">{name}</span>
  );
  const stack = layout === 'stack';
  return (
    <article
      className={cn(
        'relative flex min-w-0 gap-3 rounded-[var(--radius-md)] border border-line bg-surface-1 p-4',
        stack ? 'flex-col' : 'flex-wrap items-start',
        to && 'transition-colors duration-[var(--dur-press)] hover:border-line-strong',
        className,
      )}
    >
      <PersonAvatar name={name} fileId={photoId ?? null} size={stack ? 56 : 48} verified={!!verified} />
      <div className={cn('grid min-w-0 flex-1 gap-0.5', !stack && 'basis-40')}>
        <h3 className="text-body text-pretty break-words">{nameEl}</h3>
        {role && <p className="text-callout text-pretty break-words text-fg-2">{role}</p>}
        {batch && <p className="text-caption text-fg-3">{batch}</p>}
        {reason && <p className="mt-1 text-callout text-pretty text-fg">{reason}</p>}
        {demo && demoLabel && (
          <Badge className="mt-1 w-fit" tone="neutral">
            {demoLabel}
          </Badge>
        )}
      </div>
      {action && (
        <div className={cn('relative z-[1]', stack ? 'mt-auto' : 'flex-none self-center')}>{action}</div>
      )}
    </article>
  );
}
