import { Fragment, lazy, Suspense, useMemo, type ReactNode } from 'react';
import { useTranslation } from '../../../i18n/react';
import type { ChatCitation } from '@campuslink/shared';
import { IntentLink } from '../../../components/ui/intent-link';
import { parseAnswer, type AInline, type ABlock } from '../../../lib/answer-markdown';
import { citationHref } from '../../../lib/chat';

// KaTeX and its wrapper load only when an answer has maths.
const MathTex = lazy(() => import('./math-tex').then((m) => ({ default: m.MathTex })));

function Inline({ nodes, cite }: { nodes: AInline[]; cite: (n: number) => ReactNode }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <Fragment key={i}>{n.v}</Fragment>;
          case 'bold':
            return (
              <strong key={i} className="font-semibold">
                <Inline nodes={n.v as AInline[]} cite={cite} />
              </strong>
            );
          case 'italic':
            return (
              <em key={i}>
                <Inline nodes={n.v as AInline[]} cite={cite} />
              </em>
            );
          case 'code':
            return (
              <code key={i} className="rounded-[var(--radius-xs)] bg-surface-2 px-1 font-mono text-[0.9em]">
                {n.v}
              </code>
            );
          case 'link':
            return (
              <a
                key={i}
                href={n.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-ink underline"
              >
                {n.v}
              </a>
            );
          case 'math':
            return (
              <Suspense key={i} fallback={<code className="font-mono text-[0.9em]">{n.v}</code>}>
                <MathTex tex={n.v} />
              </Suspense>
            );
          case 'cite':
            return <Fragment key={i}>{cite(n.n)}</Fragment>;
        }
      })}
    </>
  );
}

function Block({ b, cite }: { b: ABlock; cite: (n: number) => ReactNode }) {
  switch (b.t) {
    case 'p':
      return (
        <p>
          <Inline nodes={b.v} cite={cite} />
        </p>
      );
    case 'h':
      return (
        <p className="font-semibold text-fg">
          <Inline nodes={b.v} cite={cite} />
        </p>
      );
    case 'ul':
      return (
        <ul className="grid list-disc gap-1 ps-5">
          {b.items.map((it, i) => (
            <li key={i}>
              <Inline nodes={it} cite={cite} />
            </li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol className="grid list-decimal gap-1 ps-5" start={b.start}>
          {b.items.map((it, i) => (
            <li key={i}>
              <Inline nodes={it} cite={cite} />
            </li>
          ))}
        </ol>
      );
    case 'code':
      return (
        <pre
          className="overflow-x-auto rounded-[var(--radius-md)] bg-surface-2 p-3 font-mono text-meta"
          tabIndex={0}
        >
          <code>{b.v}</code>
        </pre>
      );
    case 'math':
      return (
        <Suspense fallback={<pre className="overflow-x-auto font-mono text-meta">{b.v}</pre>}>
          <MathTex tex={b.v} display />
        </Suspense>
      );
    case 'table':
      return (
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-line" tabIndex={0}>
          <table className="w-full border-collapse text-meta">
            <thead className="bg-surface-2">
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} scope="col" className="border-b border-line px-3 py-2 text-start font-semibold">
                    <Inline nodes={c} cite={cite} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri} className="border-b border-line last:border-b-0">
                  {r.map((c, ci) => (
                    <td key={ci} className="px-3 py-2 align-top">
                      <Inline nodes={c} cite={cite} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/**
 * An answer rendered from the answer markdown subset as React elements. `[n]` becomes a small
 * link to that source (the PDF page or the video moment), when it is one of the answer's sources.
 */
export function AnswerText({ text, citations, q }: { text: string; citations: ChatCitation[]; q: string }) {
  const { t } = useTranslation();
  const blocks = useMemo(() => parseAnswer(text), [text]);
  const byN = useMemo(() => new Map(citations.map((c) => [c.n, c])), [citations]);
  const cite = (n: number) => {
    const c = byN.get(n);
    if (!c) return <span className="text-fg-3">[{n}]</span>;
    return (
      <IntentLink
        to={citationHref(c, q)}
        className="mx-0.5 inline-grid min-w-5 place-items-center rounded-full bg-brand-surface px-1 align-super text-caption font-semibold text-brand-ink hover:underline"
        aria-label={t('study.chat.sourceN', { n, title: c.title })}
      >
        {n}
      </IntentLink>
    );
  };
  return (
    <div className="grid gap-2 leading-relaxed break-words">
      {blocks.map((b, i) => (
        <Block key={i} b={b} cite={cite} />
      ))}
    </div>
  );
}
