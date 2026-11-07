import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const factory = fileURLToPath(new URL('./src/lib/icon-factory.ts', import.meta.url));
const inLucide = (id: string | undefined) =>
  !!id && /[\\/]lucide-react[\\/]dist[\\/]esm[\\/]icons[\\/]/.test(id);

/**
 * lucide icons through our own renderer (ADR 0015, prompt 3 U0): each icon module of lucide-react
 * imports `../createLucideIcon.mjs`; that import resolves to `src/lib/icon-factory.ts` instead, and
 * the random React key on every path (`key: "5wwlr5"`, which the factory does not need) is dropped.
 * The icons' names, data and props stay lucide's.
 */
export function lucideIcons(): Plugin {
  return {
    name: 'lucide-icons',
    enforce: 'pre',
    resolveId(source, importer) {
      if (inLucide(importer) && /[\\/]createLucideIcon\.mjs$/.test(source)) return factory;
      return null;
    },
    transform(code, id) {
      if (!inLucide(id)) return null;
      return { code: code.replace(/,\s*key:\s*"[^"]*"/g, ''), map: null };
    },
  };
}
