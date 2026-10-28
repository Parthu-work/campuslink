import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { APP_NAME } from '@campuslink/shared';
import {
  api,
  jpegWithExif,
  makeTenant,
  makeUser,
  testApp,
  type TestTenant,
  type TestUser,
} from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { FileModel } from '../src/modules/files/file.model.js';
import type { FilesService } from '../src/modules/files/files.service.js';

/** The college logo (decision 7): PNG or WebP only, at most 512 KB, re-encoded, public, audited. */
const ctx = testApp();
const { files } = ctx.app.locals.services as { files: FilesService };
let A: TestTenant, B: TestTenant;
let admin: TestUser, faculty: TestUser, adminB: TestUser;

const png = (w = 900, h = 300) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 30, g: 90, b: 200, alpha: 0.6 } } })
    .png()
    .toBuffer();
const upload = (u: TestUser, t: TestTenant, file: Buffer, name: string) =>
  api(ctx, t.host, u.token).post('/tenant/logo').attach('file', file, name);
const logos = (t: TestTenant) => runInTenant(t._id, () => FileModel.countDocuments({ purpose: 'branding' }));

beforeAll(async () => {
  A = await makeTenant('logoa');
  B = await makeTenant('logob');
  admin = await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true });
  faculty = await makeUser(ctx, A, { roles: ['FACULTY'] });
  adminB = await makeUser(ctx, B, { roles: ['COLLEGE_ADMIN'], mfa: true });
});

describe('college logo', () => {
  it('starts with the monogram', async () => {
    const r = await api(ctx, A.host).get('/tenant');
    expect(r.body.data.logoUrl).toBeNull();
    expect((await api(ctx, A.host).get('/tenant/logo')).status).toBe(404);
  });

  it('an admin uploads a PNG: re-encoded to WebP at most 512 px, shown to anyone on the site', async () => {
    const r = await upload(admin, A, await png(), 'crest.png');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.logoUrl).toMatch(/^\/api\/v1\/tenant\/logo\?v=[a-f0-9]{24}$/);
    expect((await api(ctx, A.host).get('/tenant')).body.data.logoUrl).toBe(r.body.data.logoUrl);
    // Signed out (the sign-in page shows it).
    const img = await api(ctx, A.host).get(r.body.data.logoUrl.replace('/api/v1', ''));
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(img.headers['content-security-policy']).toContain('sandbox');
    expect(img.headers['cache-control']).toContain('immutable');
    const meta = await sharp(img.body as Buffer).metadata();
    expect(meta.format).toBe('webp');
    // A transparent 512 px square, so it can also be the installed app's icon.
    expect([meta.width, meta.height]).toEqual([512, 512]);
    expect(meta.hasAlpha).toBe(true);
    expect(
      await runInTenant(A._id, () =>
        AuditModel.countDocuments({ action: 'tenant.logo_changed', actorId: admin.id }),
      ),
    ).toBe(1);
  });

  it('refuses SVG, JPEG, other files and anything over 512 KB', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
    );
    expect((await upload(admin, A, svg, 'logo.svg')).status).toBe(415);
    expect((await upload(admin, A, await jpegWithExif(), 'logo.jpg')).status).toBe(415);
    expect((await upload(admin, A, Buffer.from('%PDF-1.4 not a logo'), 'logo.png')).status).toBe(415);
    expect((await upload(admin, A, Buffer.alloc(600 * 1024, 1), 'big.png')).status).toBe(413);
    expect((await api(ctx, A.host, admin.token).post('/tenant/logo').send({ file: 'x' })).status).toBe(415);
    expect(await logos(A)).toBe(1);
  });

  it('only members who manage branding may change it', async () => {
    expect((await upload(faculty, A, await png(), 'x.png')).status).toBe(403);
    expect((await api(ctx, A.host, faculty.token).delete('/tenant/logo')).status).toBe(403);
    expect(
      (
        await api(ctx, A.host)
          .post('/tenant/logo')
          .attach('file', await png(), 'x.png')
      ).status,
    ).toBe(401);
    expect((await api(ctx, A.host).delete('/tenant/logo')).status).toBe(401);
  });

  it('stays within its college', async () => {
    const own = (await api(ctx, A.host).get('/tenant')).body.data.logoUrl as string;
    // Another college has no logo, even when asked for this one's id.
    expect((await api(ctx, B.host).get(own.replace('/api/v1', ''))).status).toBe(404);
    expect((await api(ctx, B.host).get('/tenant')).body.data.logoUrl).toBeNull();
    // Its admin cannot change or remove this college's logo from their own site.
    expect(
      (
        await api(ctx, A.host, adminB.token)
          .post('/tenant/logo')
          .attach('file', await png(), 'x.png')
      ).status,
    ).toBe(401);
    expect((await upload(adminB, B, await png(200, 200), 'b.png')).status).toBe(200);
    expect((await api(ctx, A.host).get('/tenant')).body.data.logoUrl).toBe(own);
    expect(await logos(A)).toBe(1);
  });

  it('replacing it deletes the old file; a new link replaces the cached one', async () => {
    const before = (await api(ctx, A.host).get('/tenant')).body.data.logoUrl as string;
    const r = await upload(admin, A, await png(400, 400), 'new.png');
    expect(r.status).toBe(200);
    expect(r.body.data.logoUrl).not.toBe(before);
    expect(await logos(A)).toBe(1);
    // A stale versioned link gets the current logo, briefly cached.
    const stale = await api(ctx, A.host).get(before.replace('/api/v1', ''));
    expect(stale.status).toBe(200);
    expect(stale.headers['cache-control']).not.toContain('immutable');
  });

  it("belongs to the college: erasing the uploader's account keeps it", async () => {
    await runInTenant(A._id, () => files.eraseFor(admin.id));
    expect((await api(ctx, A.host).get('/tenant/logo')).status).toBe(200);
  });

  it('removing it brings back the monogram, audited', async () => {
    const r = await api(ctx, A.host, admin.token).delete('/tenant/logo');
    expect(r.status).toBe(200);
    expect(r.body.data.logoUrl).toBeNull();
    expect((await api(ctx, A.host).get('/tenant/logo')).status).toBe(404);
    expect(await logos(A)).toBe(0);
    expect(
      await runInTenant(A._id, () =>
        AuditModel.countDocuments({ action: 'tenant.logo_removed', actorId: admin.id }),
      ),
    ).toBe(1);
  });
});

describe("the installed app's manifest (PW-3)", () => {
  type Manifest = {
    name: string;
    short_name: string;
    theme_color: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };
  const manifest = async (host: string) => {
    const r = await api(ctx, host).get('/tenant/manifest.webmanifest');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/manifest+json');
    return JSON.parse(r.text) as Manifest;
  };

  it("carries each college's own name and canvas colour", async () => {
    const a = await manifest(A.host);
    const b = await manifest(B.host);
    expect([a.name, a.short_name]).toEqual(['LOGOA College of Engineering', 'LOGOA']);
    expect([b.name, b.short_name]).toEqual(['LOGOB College of Engineering', 'LOGOB']);
    expect(a.theme_color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('uses the logo as the icon once a college has one, and the app icons otherwise', async () => {
    expect((await manifest(A.host)).icons.map((i) => i.purpose)).toContain('maskable');
    const up = await upload(admin, A, await png(), 'crest.png');
    expect(up.status).toBe(200);
    const icons = (await manifest(A.host)).icons;
    expect(icons[0]).toMatchObject({ src: up.body.data.logoUrl, sizes: '512x512', purpose: 'any' });
    expect(icons.map((i) => i.purpose)).not.toContain('maskable');
    // Another college is unaffected.
    expect((await manifest(B.host)).icons[0]?.src).not.toBe(up.body.data.logoUrl);
  });

  it('the platform console keeps the product name', async () => {
    const P = await makeTenant('logoplat', 'platform');
    expect((await manifest(P.host)).name).toBe(APP_NAME);
  });
});
