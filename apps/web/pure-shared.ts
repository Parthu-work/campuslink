import { parseSync, type ESTree, type Plugin } from 'vite';

type Node = { type: string; start: number; end: number; [key: string]: unknown };

const isNode = (v: unknown): v is Node =>
  typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';

/** True when evaluating the expression calls something. Function bodies run later, so they don't count. */
function calls(node: Node): boolean {
  if (
    node.type === 'CallExpression' ||
    node.type === 'NewExpression' ||
    node.type === 'TaggedTemplateExpression'
  )
    return true;
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') return false;
  return Object.values(node).some((v) =>
    Array.isArray(v) ? v.some((x) => isNode(x) && calls(x)) : isNode(v) && calls(v),
  );
}

/**
 * Wraps each top-level `const x = <expression that calls something>` in a pure IIFE, so the bundler
 * can drop the ones nothing uses. Evaluation order and values are unchanged.
 */
export function markTopLevelPure(code: string, file: string): string {
  const { program } = parseSync(file, code);
  const edits: [at: number, text: string][] = [];
  for (const statement of program.body as ESTree.Statement[]) {
    const s = statement as unknown as Node;
    const decl = s.type === 'ExportNamedDeclaration' ? (s.declaration as Node | null) : s;
    if (decl?.type !== 'VariableDeclaration') continue;
    for (const d of decl.declarations as Node[]) {
      const init = d.init as Node | null;
      if (!init || !calls(init)) continue;
      edits.push([init.start, '/* @__PURE__ */ (() => ('], [init.end, '))()']);
    }
  }
  let out = code;
  for (const [at, text] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, at) + text + out.slice(at);
  return out;
}

/**
 * `@campuslink/shared` keeps constants next to the Zod schemas that use them, and builds every
 * schema at module load. Bundlers can't tell that building a schema has no side effects, so a
 * screen that imports one constant would otherwise ship every schema in that file and Zod itself.
 * The shared package registers nothing at load (no `.register()`, no `z.config()`), which is what
 * makes this safe.
 */
export function pureShared(): Plugin {
  return {
    name: 'pure-shared',
    apply: 'build',
    transform: {
      filter: { id: /[\\/]packages[\\/]shared[\\/]dist[\\/].*\.js$/ },
      handler: (code, id) => ({ code: markTopLevelPure(code, id), map: null }),
    },
  };
}
