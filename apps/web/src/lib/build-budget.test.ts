import { describe, expect, it, vi } from 'vitest';
import { markTopLevelPure } from '../../pure-shared';
import { toast } from './toast';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const load = (code: string) =>
  import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as Promise<
    Record<string, unknown>
  >;

describe('pure-shared (vite plugin for @campuslink/shared)', () => {
  const source = [
    'let calls = 0;',
    'const make = (n) => ({ n, order: ++calls });',
    'const a = make(1);',
    'export const b = { a, c: make(2) };',
    "export const LIST = ['x', 'y'];",
    'export const fn = () => make(3);',
    'export function count() { return calls; }',
  ].join('\n');

  it('marks top-level initialisers that call something, and nothing else', () => {
    const out = markTopLevelPure(source, 'schemas.js');
    expect(out).toContain('const a = /* @__PURE__ */ (() => (make(1)))();');
    expect(out).toContain('export const b = /* @__PURE__ */ (() => ({ a, c: make(2) }))();');
    expect(out).toContain("export const LIST = ['x', 'y'];");
    expect(out).toContain('export const fn = () => make(3);');
    expect(out).toContain('const make = (n) => ({ n, order: ++calls });');
  });

  it('keeps values and evaluation order', async () => {
    const before = await load(source);
    const after = await load(markTopLevelPure(source, 'schemas.js'));
    expect(after.b).toEqual(before.b);
    expect(after.LIST).toEqual(before.LIST);
    expect((after.count as () => number)()).toBe(2);
  });
});

describe('toast (sonner on first use)', () => {
  it('forwards every call to sonner once it has loaded', async () => {
    const sonner = (await import('sonner')).toast as unknown as ReturnType<typeof vi.fn> & {
      success: ReturnType<typeof vi.fn>;
      error: ReturnType<typeof vi.fn>;
    };
    toast.success('Saved');
    toast.error('Nope', { description: 'Try again' });
    toast('Update ready', { id: 'pwa' });
    await vi.waitFor(() => expect(sonner).toHaveBeenCalledWith('Update ready', { id: 'pwa' }));
    expect(sonner.success).toHaveBeenCalledWith('Saved');
    expect(sonner.error).toHaveBeenCalledWith('Nope', { description: 'Try again' });
  });
});
