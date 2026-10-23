import { useEffect, useRef, useState } from 'react';

/**
 * Maths in an answer. KaTeX loads only when an answer contains maths, and builds MathML DOM nodes
 * itself into an empty element React never fills (no HTML string is ever inserted); `trust: false`
 * refuses links and raw HTML commands. Until it loads, or if the TeX is invalid, the source shows
 * as code.
 */
export function MathTex({ tex, display = false }: { tex: string; display?: boolean }) {
  const target = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    let live = true;
    void import('../../../lib/katex')
      .then(({ renderTex }) => {
        if (!live || !target.current) return;
        renderTex(tex, target.current, display);
        setState('ready');
      })
      .catch(() => live && setState('failed'));
    return () => {
      live = false;
    };
  }, [tex, display]);
  return (
    <span
      className={display ? 'my-2 block overflow-x-auto text-center' : 'inline-block max-w-full align-middle'}
    >
      {state !== 'ready' && (
        <code className="rounded-[var(--radius-xs)] bg-surface-2 px-1 font-mono text-[0.9em]">{tex}</code>
      )}
      <span ref={target} hidden={state !== 'ready'} />
    </span>
  );
}
