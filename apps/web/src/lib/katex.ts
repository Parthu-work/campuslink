import katex from 'katex';

/**
 * KaTeX behind one module, imported only with `import()` when an answer contains maths (its own
 * chunk, listed with a reason in scripts/bundle-budget.mjs). MathML output: the browser draws it,
 * so no KaTeX fonts or stylesheet are needed.
 */
export function renderTex(tex: string, into: HTMLElement, display: boolean) {
  katex.render(tex, into, {
    displayMode: display,
    output: 'mathml',
    throwOnError: true,
    trust: false,
    strict: 'ignore',
    maxSize: 20,
    maxExpand: 200,
  });
}
