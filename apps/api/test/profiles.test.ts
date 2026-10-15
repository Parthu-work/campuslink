import { beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  jpegWithExif,
  makeTenant,
  makeUser,
  testApp,
  type TestTenant,
  type TestUser,
} from './helpers.js';
import { canSee } from '../src/modules/profiles/profiles.service.js';

const ctx = testApp();
let T: TestTenant;
let alum: TestUser, student: TestUser, faculty: TestUser, unverified: TestUser;

beforeAll(async () => {
  T = await makeTenant('prof');
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  unverified = await makeUser(ctx, T, { roles: ['STUDENT'], verified: false });
  await api(ctx, T.host, alum.token)
    .put('/me/profile')
    .send({
      headline: 'SDE II, backend',
      company: 'Nimbus Labs',
      jobTitle: 'SDE II',
      skills: ['Java', 'System design'],
      bio: 'Happy to help juniors.',
      phone: '9848022338',
      links: [{ label: 'github', url: 'https://github.com/example' }],
      visibility: { phone: 'alumni_staff', bio: 'only_me', email: 'members' },
    });
  await api(ctx, T.host, student.token)
    .put('/me/profile')
    .send({ headline: 'Final-year CSE', skills: ['React'] });
});

describe('visibility rules', () => {
  it('canSee matrix', () => {
    expect(canSee('members', ['STUDENT'], false)).toBe(true);
    expect(canSee('alumni_staff', ['STUDENT'], false)).toBe(false);
    expect(canSee('alumni_staff', ['FACULTY'], false)).toBe(true);
    expect(canSee('only_me', ['COLLEGE_ADMIN'], false)).toBe(false);
    expect(canSee('only_me', ['STUDENT'], true)).toBe(true);
  });

  it('contact details are hidden by default', async () => {
    const p = await api(ctx, T.host, alum.token).get(`/profiles/${student.id}`);
    expect(p.body.data.fields.email).toBeUndefined();
    expect(p.body.data.fields.phone).toBeUndefined();
    expect(p.body.data.fields.headline).toBe('Final-year CSE');
  });

  it('applies per-field audiences for each viewer', async () => {
    const byStudent = (await api(ctx, T.host, student.token).get(`/profiles/${alum.id}`)).body.data;
    expect(byStudent.fields).toMatchObject({ company: 'Nimbus Labs', email: alum.email });
    expect(byStudent.fields.phone).toBeUndefined();
    expect(byStudent.fields.bio).toBeUndefined();
    const byFaculty = (await api(ctx, T.host, faculty.token).get(`/profiles/${alum.id}`)).body.data;
    expect(byFaculty.fields.phone).toBe('+919848022338');
    expect(byFaculty.fields.bio).toBeUndefined();
    const own = (await api(ctx, T.host, alum.token).get('/me/profile')).body.data;
    expect(own.profile.fields.bio).toBe('Happy to help juniors.');
    expect(own.visibility.phone).toBe('alumni_staff');
  });

  it('rejects unsafe links and HTML-ish tags', async () => {
    expect(
      (
        await api(ctx, T.host, alum.token)
          .put('/me/profile')
          .send({ links: [{ label: 'other', url: 'javascript:alert(1)' }] })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(ctx, T.host, alum.token)
          .put('/me/profile')
          .send({ links: [{ label: 'other', url: 'http://github.com/x' }] })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(ctx, T.host, alum.token)
          .put('/me/profile')
          .send({ skills: ['<img src=x onerror=alert(1)>'] })
      ).status,
    ).toBe(400);
  });
});

describe('directory and search', () => {
  it('lists verified members only, with filters', async () => {
    const all = await api(ctx, T.host, student.token).get('/directory');
    const ids = all.body.data.map((p: { userId: string }) => p.userId);
    expect(ids).toEqual(expect.arrayContaining([alum.id, student.id, faculty.id]));
    expect(ids).not.toContain(unverified.id);
    const alumni = await api(ctx, T.host, student.token).get('/directory?role=ALUMNI');
    expect(alumni.body.data.map((p: { userId: string }) => p.userId)).toEqual([alum.id]);
    expect(alumni.body.data[0].fields.phone).toBeUndefined();
  });

  it('searches by name, company and skills', async () => {
    const r = await api(ctx, T.host, student.token).get('/search?q=Nimbus');
    expect(r.body.data.people.map((p: { userId: string }) => p.userId)).toContain(alum.id);
    const d = await api(ctx, T.host, student.token).get('/directory?q=system design');
    expect(d.body.data.map((p: { userId: string }) => p.userId)).toContain(alum.id);
  });

  it('unverified members cannot browse the directory or search', async () => {
    expect((await api(ctx, T.host, unverified.token).get('/directory')).status).toBe(403);
    expect((await api(ctx, T.host, unverified.token).get('/search?q=Nimbus')).status).toBe(403);
    expect((await api(ctx, T.host, student.token).get(`/profiles/${unverified.id}`)).status).toBe(404);
  });

  it('suspended members disappear from the directory', async () => {
    const admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
    const gone = await makeUser(ctx, T, { roles: ['ALUMNI'] });
    await api(ctx, T.host, gone.token).put('/me/profile').send({ headline: 'Soon gone' });
    await api(ctx, T.host, admin.token).patch(`/admin/users/${gone.id}/status`).send({ status: 'suspended' });
    expect((await api(ctx, T.host, student.token).get(`/profiles/${gone.id}`)).status).toBe(404);
  });
});

describe('avatars', () => {
  it('re-encodes to WebP, strips metadata, and serves to members only', async () => {
    const r = await api(ctx, T.host, alum.token)
      .post('/me/avatar')
      .attach('photo', await jpegWithExif(), 'me.jpg');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const img = await api(ctx, T.host, student.token).get(`/files/${r.body.data.avatarFileId}`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(img.body).toString('latin1')).not.toContain('SECRET-EXIF-MARKER');
    expect((await api(ctx, T.host).get(`/files/${r.body.data.avatarFileId}`)).status).toBe(401);
  });

  it('requires multipart and enforces the size limit', async () => {
    expect((await api(ctx, T.host, alum.token).post('/me/avatar').send({ photo: 'x' })).status).toBe(415);
    expect(
      (
        await api(ctx, T.host, alum.token)
          .post('/me/avatar')
          .attach('photo', Buffer.alloc(4 * 1024 * 1024, 1), 'big.jpg')
      ).status,
    ).toBe(413);
  });
});
