import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateDocs, DOCS_DIR } from '../src/scripts/gen-docs.js';

describe('generated docs are current', () => {
  it('docs/permissions.md and docs/api/openapi.json match the code (run `pnpm --filter @campuslink/api docs:gen`)', () => {
    const { permissionsMd, openapi } = generateDocs();
    expect(readFileSync(resolve(DOCS_DIR, 'permissions.md'), 'utf8')).toBe(permissionsMd);
    expect(readFileSync(resolve(DOCS_DIR, 'api/openapi.json'), 'utf8')).toBe(openapi);
  });
});
