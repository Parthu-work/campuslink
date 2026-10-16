import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { makeReferrer, postJob } from './jobs-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { JobAlertModel, JobModel } from '../src/modules/jobs/job.model.js';
import { JobsService } from '../src/modules/jobs/jobs.service.js';

const ctx = testApp();
let T: TestTenant;
let alum: TestUser, alum2: TestUser, student: TestUser, staff: TestUser, mod: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);

beforeAll(async () => {
  T = await makeTenant('jobstest');
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  alum2 = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  staff = await makeUser(ctx, T, { roles: ['TPO'] });
  mod = await makeUser(ctx, T, { roles: ['FACULTY'] });
  await runInTenant(T._id, () =>
    ProfileModel.updateOne(
      { userId: student.id },
      { $set: { branch: 'CSE', skills: ['Java', 'SQL', 'React'] } },
    ),
  );
});

describe('posting', () => {
  it('alumni and staff post; students cannot; input is validated and stored as plain text', async () => {
    const j = await postJob(ctx, T, alum, {
      description: 'Build <b>REST</b> APIs<script>x()</script> for our payments product.',
    });
    expect(j).toMatchObject({
      title: 'Backend Developer',
      company: 'Nimbus Labs',
      origin: 'posted',
      isMine: true,
      freshersOk: true,
      status: 'open',
      description: 'Build REST APIs for our payments product.',
    });
    expect((await as(student).post('/jobs').send({})).status).toBe(403);
    expect((await as(alum).post('/jobs').send({ title: 'x' })).status).toBe(400);
    const bad = await as(alum).post('/jobs').send({
      title: 'Backend Developer',
      company: 'Nimbus Labs',
      location: 'Hyderabad',
      mode: 'hybrid',
      type: 'full_time',
      level: 'junior',
      applyUrl: 'http://insecure.example/apply',
      description: 'A long enough description of the role and team.',
    });
    expect(bad.status).toBe(400);
    const tpo = await postJob(ctx, T, staff, {
      title: 'Campus drive: Graduate Engineer',
      company: 'Delta Demo',
    });
    expect(tpo.postedBy).toMatchObject({ userId: staff.id });
  });

  it('only the poster closes an opening; closed jobs leave the list', async () => {
    const j = await postJob(ctx, T, alum, { title: 'Closing Role Demo' });
    expect((await as(alum2).post(`/jobs/${j.id}/close`).send({})).status).toBe(404);
    expect((await as(alum).post(`/jobs/${j.id}/close`).send({})).status).toBe(200);
    expect((await as(student).get('/jobs?q=Closing')).body.data).toEqual([]);
    expect((await as(student).get(`/jobs/${j.id}`)).body.data.status).toBe('closed');
    expect((await as(alum).get('/jobs?mine=true')).body.data.map((x: { id: string }) => x.id)).toContain(
      j.id,
    );
  });
});

describe('finding jobs', () => {
  beforeAll(async () => {
    await postJob(ctx, T, alum2, {
      title: 'Mechanical Design Engineer',
      company: 'Orbit Motors',
      location: 'Pune',
      mode: 'onsite',
      level: 'junior',
      skills: ['SolidWorks', 'AutoCAD'],
      branches: ['MECH'],
      applyUrl: 'https://orbit.example/careers/2',
      description: 'Design fixtures and gearboxes using SolidWorks. One to three years of experience.',
    });
    await postJob(ctx, T, alum2, {
      title: 'Data Analyst Intern',
      company: 'Quanta Demo',
      location: 'Remote',
      mode: 'remote',
      type: 'internship',
      level: 'fresher',
      skills: ['SQL', 'Excel'],
      branches: [],
      applyUrl: 'https://quanta.example/careers/3',
      description: 'Six-month internship building dashboards with SQL and Excel. Any branch.',
    });
  });

  it('filters by skills, branch, level, mode, type, location and fresher', async () => {
    const titles = async (qs: string) =>
      ((await as(student).get(`/jobs?${qs}`)).body.data as { title: string }[]).map((j) => j.title);
    expect(await titles('skills=solidworks')).toEqual(['Mechanical Design Engineer']);
    expect(await titles('branch=MECH')).toEqual(
      expect.arrayContaining(['Mechanical Design Engineer', 'Data Analyst Intern']),
    );
    expect(await titles('branch=MECH')).not.toContain('Backend Developer');
    expect(await titles('level=junior')).toEqual(['Mechanical Design Engineer']);
    expect(await titles('mode=remote')).toEqual(['Data Analyst Intern']);
    expect(await titles('type=internship')).toEqual(['Data Analyst Intern']);
    expect(await titles('location=pune')).toEqual(['Mechanical Design Engineer']);
    expect(await titles('fresher=true')).not.toContain('Mechanical Design Engineer');
    expect(await titles('q=gearboxes')).toEqual(['Mechanical Design Engineer']);
    expect(await titles('q=Mech')).toEqual(['Mechanical Design Engineer']);
    expect((await as(student).get('/jobs?level=wizard')).status).toBe(400);
    expect((await as(student).get('/jobs?skills[$ne]=x')).status).toBe(400);
  });

  it('pages with a cursor', async () => {
    const p1 = await as(student).get('/jobs?limit=2');
    expect(p1.body.data).toHaveLength(2);
    const p2 = await as(student).get(`/jobs?limit=2&cursor=${p1.body.meta.nextCursor}`);
    const ids = new Set([...p1.body.data, ...p2.body.data].map((j: { id: string }) => j.id));
    expect(ids.size).toBe(p1.body.data.length + p2.body.data.length);
  });

  it('Job Radar puts skill and branch matches first for a student', async () => {
    const r = (await as(student).get('/jobs/radar')).body.data;
    const top = r.forYou.slice(0, 2).map((j: { title: string }) => j.title);
    expect(top).toContain('Backend Developer');
    expect(top).not.toContain('Mechanical Design Engineer');
    expect(r.fresherFriendly.map((j: { title: string }) => j.title)).toContain('Data Analyst Intern');
    expect(r.newThisWeek).toBeGreaterThanOrEqual(3);
    expect(r.closingSoon).toEqual([]);
  });

  it('command palette search finds jobs', async () => {
    const r = await as(student).get('/search?q=gearboxes');
    expect(r.body.data.jobs.map((j: { title: string }) => j.title)).toEqual(['Mechanical Design Engineer']);
  });
});

describe('alumni at this company', () => {
  it('counts verified alumni whose company is visible to the viewer', async () => {
    const j = await postJob(ctx, T, staff, { title: 'Platform Engineer', company: 'Zenith Cloud Pvt Ltd' });
    expect(j.alumniCount).toBe(0);
    await as(alum).put('/me/profile').send({ company: 'Zenith Cloud' });
    await as(alum2)
      .put('/me/profile')
      .send({ company: 'ZENITH CLOUD LIMITED', visibility: { company: 'only_me' } });
    const v = (await as(student).get(`/jobs/${j.id}`)).body.data;
    expect(v).toMatchObject({ alumniCount: 1, referrers: 0 });
    await makeReferrer(ctx, T, alum, 'Zenith Cloud');
    expect((await as(student).get(`/jobs/${j.id}`)).body.data).toMatchObject({
      alumniCount: 1,
      referrers: 1,
    });
    expect((await as(student).get('/jobs?alumni=true')).body.data.map((x: { id: string }) => x.id)).toContain(
      j.id,
    );
    // The alumnus is not counted for themselves.
    expect((await as(alum).get(`/jobs/${j.id}`)).body.data.alumniCount).toBe(0);
    const radar = (await as(student).get('/jobs/radar')).body.data;
    expect(radar.alumniCanRefer.map((x: { id: string }) => x.id)).toContain(j.id);
  });
});

describe('saved jobs, tracker and alerts', () => {
  it('saves, tracks status privately, and keeps the entry after the listing closes', async () => {
    const j = await postJob(ctx, T, alum2, { title: 'Tracked Role Demo', company: 'Track Demo' });
    const r = await as(student).put(`/jobs/${j.id}/track`).send({ status: 'saved' });
    expect(r.body.data.track).toMatchObject({ status: 'saved', note: '' });
    await as(student)
      .put(`/jobs/${j.id}/track`)
      .send({ status: 'applied', note: 'Applied via <b>portal</b>' });
    expect((await as(student).put(`/jobs/${j.id}/track`).send({ status: 'hired' })).status).toBe(400);
    let t = (await as(student).get('/me/job-tracker')).body.data;
    expect(t[0]).toMatchObject({
      jobId: j.id,
      status: 'applied',
      note: 'Applied via portal',
      title: 'Tracked Role Demo',
    });
    // Private: the poster sees no tracker data.
    expect((await as(alum2).get(`/jobs/${j.id}`)).body.data.track).toBeNull();
    await as(alum2).post(`/jobs/${j.id}/close`).send({});
    t = (await as(student).get('/me/job-tracker')).body.data;
    expect(t[0]).toMatchObject({ title: 'Tracked Role Demo', job: { status: 'closed' } });
    await as(student).delete(`/jobs/${j.id}/track`);
    expect(
      (await as(student).get('/me/job-tracker')).body.data.map((x: { jobId: string }) => x.jobId),
    ).not.toContain(j.id);
    expect((await as(alum).put(`/jobs/${j.id}/track`).send({ status: 'saved' })).status).toBe(200);
  });

  it('alerts: up to five, daily, one notification per match batch', async () => {
    const a = await as(student)
      .post('/me/job-alerts')
      .send({ name: 'Java in Hyderabad', filters: { skills: ['Java'], location: 'Hyderabad' } });
    expect(a.status).toBe(201);
    expect(a.body.data.filters).toEqual({ skills: ['Java'], location: 'Hyderabad' });
    for (let i = 0; i < 4; i++)
      await as(student)
        .post('/me/job-alerts')
        .send({ name: `Alert ${i}`, filters: { mode: 'remote' } });
    expect((await as(student).post('/me/job-alerts').send({ name: 'Too many', filters: {} })).status).toBe(
      409,
    );
    // Make the first alert due, post a matching job, run the scheduler.
    await runInTenant(T._id, () =>
      JobAlertModel.updateOne(
        { _id: a.body.data.id },
        { $set: { nextRunAt: new Date(Date.now() - 1000), lastRunAt: new Date(Date.now() - 60_000) } },
      ),
    );
    await postJob(ctx, T, alum2, {
      title: 'Java Engineer Alert Demo',
      company: 'Alert Demo',
      skills: ['Java'],
    });
    expect(await JobsService.enqueueDueAlerts(ctx.queue)).toBeGreaterThanOrEqual(1);
    await ctx.queue.drain();
    const n = (await as(student).get('/notifications')).body.data.find(
      (x: { type: string }) => x.type === 'job_alert',
    );
    expect(n.data).toMatchObject({ alert: 'Java in Hyderabad', alertId: a.body.data.id });
    // Not due again for a day.
    expect(await JobsService.enqueueDueAlerts(ctx.queue)).toBe(0);
    expect((await as(student).delete(`/me/job-alerts/${a.body.data.id}`)).status).toBe(200);
    expect((await as(alum).delete(`/me/job-alerts/${a.body.data.id}`)).status).toBe(404);
  });
});

describe('expiry, moderation and blocks', () => {
  it('expired jobs drop out of lists but stay readable', async () => {
    const j = await postJob(ctx, T, alum2, { title: 'Expiring Role Demo', company: 'Expire Demo' });
    await runInTenant(T._id, () =>
      JobModel.updateOne({ _id: j.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } }),
    );
    expect((await as(student).get('/jobs?q=Expiring')).body.data).toEqual([]);
    expect((await as(student).get(`/jobs/${j.id}`)).body.data.status).toBe('expired');
  });

  it('members report spam postings; moderators remove them with a reason the poster sees', async () => {
    const j = await postJob(ctx, T, alum2, { title: 'Pay to apply demo', company: 'Scam Demo' });
    expect(
      (await as(student).post('/reports').send({ targetType: 'job', targetId: j.id, reason: 'spam' })).status,
    ).toBe(201);
    expect(
      (
        await as(mod)
          .post('/admin/moderation/actions')
          .send({ targetType: 'job', targetId: j.id, action: 'remove', reason: 'spam' })
      ).status,
    ).toBe(200);
    expect((await as(student).get(`/jobs/${j.id}`)).status).toBe(404);
    expect((await as(alum2).get(`/jobs/${j.id}`)).body.data).toMatchObject({
      status: 'closed',
      removal: { reason: 'spam' },
    });
    const n = (await as(alum2).get('/notifications')).body.data.find(
      (x: { type: string }) => x.type === 'content_removed',
    );
    expect(n.data).toMatchObject({ contentType: 'job', contentId: j.id });
  });

  it('blocking hides the poster’s jobs', async () => {
    const j = await postJob(ctx, T, alum2, { title: 'Blocked Poster Demo', company: 'Block Demo' });
    await as(student).post('/me/blocks').send({ userId: alum2.id });
    expect((await as(student).get(`/jobs/${j.id}`)).status).toBe(404);
    expect((await as(student).get('/jobs?q=Blocked')).body.data).toEqual([]);
    await as(student).delete(`/me/blocks/${alum2.id}`);
  });
});
