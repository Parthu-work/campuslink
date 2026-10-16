import { Fragment, useMemo, type ReactNode } from 'react';
import { parseBlocks, type Inline } from '../../lib/markdown';
import { cn } from '../../lib/cn';

function inline(nodes: Inline[], key = ''): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.t) {
      case 'text':
        return <Fragment key={k}>{n.v}</Fragment>;
      case 'bold':
        return <strong key={k}>{inline(n.v, `${k}-`)}</strong>;
      case 'italic':
        return <em key={k}>{inline(n.v, `${k}-`)}</em>;
      case 'code':
        return (
          <code key={k} className="rounded bg-surface-2 px-1 font-mono text-[0.9em]">
            {n.v}
          </code>
        );
      case 'link':
        return (
          <a
            key={k}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="break-words text-brand-ink underline underline-offset-2"
          >
            {n.v}
          </a>
        );
      case 'tag':
        return (
          <span key={k} className="font-medium text-brand-ink">
            #{n.v}
          </span>
        );
    }
  });
}

/** Renders the markdown subset as React elements (never innerHTML). */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className={cn('grid gap-2 leading-relaxed break-words', className)}>
      {blocks.map((b, i) =>
        b.t === 'ul' ? (
          <ul key={i} className="ml-5 list-disc">
            {b.items.map((it, j) => (
              <li key={j}>{inline(it, `${i}-${j}-`)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l, `${i}-${j}-`)}
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  );
}
