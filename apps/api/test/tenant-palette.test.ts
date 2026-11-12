import { beforeAll, describe, expect, it } from 'vitest';
import { generatePalette } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';

/**
 * The college's palette comes with the public tenant (prompt 3, U0): the API generates it from the
 * college's colours, so the web app no longer ships the generator. Same tokens as ADR 0008's
 * generator; a branding change is reflected at once.
 */
const ctx = testApp();
let A: TestTenant;
let admin: TestUser;

beforeAll(async () => {
  A = await makeTenant('palettea');
  admin = await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true });
});

describe('tenant palette', () => {
  it('is the generated palette for the college colours, both themes and the chrome', async () => {
    const res = await api(ctx, A.host).get('/tenant');
    expect(res.status).toBe(200);
    const { palette, branding } = res.body.data;
    const expected = generatePalette({ primary: branding.primary, accent: branding.accent });
    expect(palette).toEqual({ light: expected.light, dark: expected.dark, chrome: expected.chrome });
    expect(palette.light['--brand-ink']).toMatch(/^oklch\(/);
  });

  it('follows a branding change', async () => {
    const before = (await api(ctx, A.host).get('/tenant')).body.data.palette;
    const current = (await api(ctx, A.host).get('/tenant')).body.data.branding;
    const res = await api(ctx, A.host, admin.token)
      .put('/tenant/branding')
      .send({ ...current, primary: '#c2410c' });
    expect(res.status).toBe(200);
    expect(res.body.data.palette.light['--brand']).not.toBe(before.light['--brand']);
    const after = (await api(ctx, A.host).get('/tenant')).body.data.palette;
    expect(after).toEqual(res.body.data.palette);
  });
});
