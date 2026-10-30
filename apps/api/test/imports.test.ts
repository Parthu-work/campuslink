import { beforeAll, describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  api,
  makeTenant,
  makeUser,
  makeXlsx,
  testApp,
  SAMPLE_CSV,
  type TestTenant,
  type TestUser,
} from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { WhitelistModel } from '../src/modules/imports/whitelist.model.js';
import { mapRow, csvCell, suggestMapping, normaliseBranch } from '../src/modules/imports/imports.service.js';
import { googleSheetCsvUrl } from '../src/modules/imports/adapters/remote.js';
import { assertSafeZip } from '../src/lib/zip-guard.js';
import type { SafeResponse } from '../src/lib/safe-fetch.js';

const remote: {
  body: string;
  status?: number;
  contentType?: string | undefined;
  lastUrl?: string;
  lastHeaders?: Record<string, string>;
} = { body: '' };
const ctx = testApp({
  fetcher: async (url, opts) => {
    remote.lastUrl = url;
    remote.lastHeaders = opts?.headers ?? {};
    return {
      status: remote.status ?? 200,
      contentType: remote.contentType ?? 'text/csv',
      body: Buffer.from(remote.body),
      finalUrl: url,
    } satisfies SafeResponse;
  },
});
let T: TestTenant;
let admin: TestUser;
const MAPPING = {
  columns: {
    rollNumber: 'Roll No',
    name: 'Student Name',
    branch: 'Department',
    gradYear: 'Batch',
    email: 'Email',
    phone: 'Mobile',
  },
  defaultKind: 'derive' as const,
};

const upload = (buf: Buffer | string, name = 'students.csv') =>
  api(ctx, T.host, admin.token).post('/admin/imports/preview/upload').attach('file', Buffer.from(buf), name);
async function runImport(buf: Buffer | string, opts: { dryRun?: boolean; name?: string } = {}) {
  const pre = await upload(buf, opts.name);
  expect(pre.status, JSON.stringify(pre.body)).toBe(201);
  const start = await api(ctx, T.host, admin.token)
    .post('/admin/imports')
    .send({ previewId: pre.body.data.previewId, mapping: MAPPING, dryRun: !!opts.dryRun });
  expect(start.status, JSON.stringify(start.body)).toBe(202);
  await ctx.queue.drain();
  return (await api(ctx, T.host, admin.token).get(`/admin/imports/${start.body.data.id}`)).body.data;
}
const count = () => runInTenant(T._id, () => WhitelistModel.countDocuments({}));

beforeAll(async () => {
  T = await makeTenant('imp');
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
});

describe('mapping helpers', () => {
  it('suggests columns from common Indian college headers', () => {
    expect(
      suggestMapping([
        'Hall Ticket No',
        'Candidate Name',
        'Dept',
        'Year of Passing',
        'Email ID',
        'Mobile No',
      ]),
    ).toEqual({
      rollNumber: 'Hall Ticket No',
      name: 'Candidate Name',
      branch: 'Dept',
      gradYear: 'Year of Passing',
      email: 'Email ID',
      phone: 'Mobile No',
    });
  });
  it('normalises branches, phones, years and kind', () => {
    expect(normaliseBranch('Computer Science and Engineering')).toBe('CSE');
    expect(normaliseBranch('Electrical & Electronics')).toBe('EEE');
    expect(normaliseBranch('Biotech')).toBe('OTHER');
    const r = mapRow(
      { R: ' 21dp1a 0501 ', N: 'A  B', Y: '2021-2025', P: '098480 22338' },
      {
        type: 'roster',
        columns: { rollNumber: 'R', name: 'N', gradYear: 'Y', phone: 'P' },
        academicColumns: {},
        defaultKind: 'derive',
      },
      new Date('2026-10-01'),
    );
    expect(r).toEqual({
      ok: true,
      value: {
        rollNumber: '21DP1A0501',
        name: 'A B',
        branch: null,
        gradYear: 2025,
        kind: 'alumni',
        email: null,
        phone: '+919848022338',
        guardianPhone: null,
      },
    });
    const s = mapRow(
      { R: 'X12345', N: 'Name', Y: '2027' },
      {
        type: 'roster',
        columns: { rollNumber: 'R', name: 'N', gradYear: 'Y' },
        academicColumns: {},
        defaultKind: 'derive',
      },
      new Date('2026-10-01'),
    );
    expect(s.ok && s.value.kind).toBe('student');
  });
  it('escapes CSV formula injection', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+91')).toBe("'+91");
    expect(csvCell('plain')).toBe('plain');
  });
  it('converts Google Sheets links to the official CSV export URL', () => {
    expect(
      googleSheetCsvUrl(
        'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=12345',
      ),
    ).toBe(
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/export?format=csv&gid=12345',
    );
    expect(() =>
      googleSheetCsvUrl('https://evil.example/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'),
    ).toThrow();
  });
});

describe('import lifecycle', () => {
  it('previews a CSV with suggested mapping and only 10 sample rows', async () => {
    const r = await upload(SAMPLE_CSV);
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      totalRows: 7,
      headers: ['Roll No', 'Student Name', 'Department', 'Batch', 'Email', 'Mobile'],
    });
    expect(r.body.data.suggestedMapping.rollNumber).toBe('Roll No');
  });

  it('a dry run reports counts and errors without writing anything', async () => {
    const job = await runImport(SAMPLE_CSV, { dryRun: true });
    expect(job.status).toBe('completed');
    expect(job.counts).toMatchObject({ total: 7, created: 4, errors: 3 });
    expect(await count()).toBe(0);
  });

  it('imports, encrypts contact details and reports row-level errors without values', async () => {
    const job = await runImport(SAMPLE_CSV);
    expect(job.counts).toMatchObject({ created: 4, updated: 0, errors: 3 });
    expect(job.rowErrors).toEqual([
      { row: 6, field: 'rollNumber', message: 'Missing roll number' },
      { row: 7, field: 'rollNumber', message: 'Duplicate of row 2' },
      { row: 8, field: 'email', message: 'Invalid email' },
    ]);
    const rec = await runInTenant(T._id, () => WhitelistModel.findOne({ rollNumber: '21DP1A0501' }).lean());
    expect(rec).toMatchObject({ name: 'Ananya Kumari', branch: 'CSE', gradYear: 2025, status: 'unclaimed' });
    expect(rec!.emailEnc).toMatch(/^v2\.[A-Za-z0-9_-]{8}\./);
    expect(JSON.stringify(rec)).not.toContain('ananya.k@dpit.ac.in');
    const csv = await api(ctx, T.host, admin.token).get(`/admin/imports/${job.id}/errors.csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment');
    expect(csv.text).toContain('row,field,problem');
    expect(csv.text).not.toContain('not-an-email');
  });

  it('re-importing the same file is a no-op (idempotent)', async () => {
    const job = await runImport(SAMPLE_CSV);
    expect(job.counts).toMatchObject({ created: 0, updated: 0, unchanged: 4 });
    expect(await count()).toBe(4);
  });

  it('updates changed rows and can roll back only the latest import', async () => {
    const first = (await api(ctx, T.host, admin.token).get('/admin/imports')).body.data.find(
      (j: { dryRun: boolean; counts: { created: number } }) => !j.dryRun && j.counts.created === 4,
    );
    const changed =
      SAMPLE_CSV.replace('Bharath Reddy', 'Bharath K Reddy') + '\n22DP1A0505,Eshwar Goud,CIVIL,2026,,';
    const job = await runImport(changed);
    expect(job.counts).toMatchObject({ created: 1, updated: 1, unchanged: 3 });
    expect((await api(ctx, T.host, admin.token).post(`/admin/imports/${first.id}/rollback`)).status).toBe(
      409,
    );
    const rb = await api(ctx, T.host, admin.token).post(`/admin/imports/${job.id}/rollback`);
    expect(rb.body.data).toEqual({ removed: 1, restored: 1, keptClaimed: 0 });
    expect(
      (await runInTenant(T._id, () => WhitelistModel.findOne({ rollNumber: '21DP1A0502' }).lean()))?.name,
    ).toBe('Bharath Reddy');
    expect(await count()).toBe(4);
    expect((await api(ctx, T.host, admin.token).post(`/admin/imports/${job.id}/rollback`)).status).toBe(409);
  });

  it('never modifies a record someone already claimed', async () => {
    await runInTenant(T._id, () =>
      WhitelistModel.updateOne({ rollNumber: '17DP1A0301' }, { $set: { status: 'claimed' } }),
    );
    const job = await runImport(SAMPLE_CSV.replace('Chaitanya Rao', 'Imposter Name'));
    expect(job.counts.skippedClaimed).toBe(1);
    expect(
      (await runInTenant(T._id, () => WhitelistModel.findOne({ rollNumber: '17DP1A0301' }).lean()))?.name,
    ).toBe('Chaitanya Rao');
  });

  it('reads .xlsx files', async () => {
    const xlsx = await makeXlsx([
      ['Roll No', 'Student Name', 'Batch'],
      ['19DP1A0401', 'Farhan Ali', '2023'],
      ['19DP1A0402', 'Gayatri Devi', '2023'],
    ]);
    const pre = await upload(xlsx, 'list.xlsx');
    expect(pre.status, JSON.stringify(pre.body)).toBe(201);
    expect(pre.body.data).toMatchObject({ totalRows: 2, headers: ['Roll No', 'Student Name', 'Batch'] });
  });

  it('rejects non-spreadsheet uploads, zip bombs and missing required mapping', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    expect((await upload(png, 'x.csv')).status).toBe(415);
    const bomb = Buffer.from(
      zipSync({ 'xl/worksheets/sheet1.xml': strToU8('A'.repeat(5_000_000)) }, { level: 9 }),
    );
    expect(() => assertSafeZip(bomb)).toThrow(/expands too much|too large/);
    const pre = await upload(SAMPLE_CSV);
    const r = await api(ctx, T.host, admin.token)
      .post('/admin/imports')
      .send({ previewId: pre.body.data.previewId, mapping: { columns: { name: 'Student Name' } } });
    expect(r.status).toBe(400);
    const bad = await api(ctx, T.host, admin.token)
      .post('/admin/imports')
      .send({
        previewId: pre.body.data.previewId,
        mapping: { columns: { rollNumber: 'Nope', name: 'Student Name' } },
      });
    expect(bad.status).toBe(400);
  });

  it('enforces the upload size limit', async () => {
    const big = 'a,b\n' + 'x,y\n'.repeat(1_400_000);
    expect((await upload(big)).status).toBe(413);
  });
});

describe('remote sources', () => {
  it('Google Sheets: uses the CSV export URL; explains access errors', async () => {
    remote.body = 'Roll No,Student Name,Batch\n20DP1A0101,Harini S,2024';
    const r = await api(ctx, T.host, admin.token).post('/admin/imports/preview/remote').send({
      kind: 'gsheet',
      url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(remote.lastUrl).toContain('/export?format=csv');
    remote.contentType = 'text/html';
    const denied = await api(ctx, T.host, admin.token).post('/admin/imports/preview/remote').send({
      kind: 'gsheet',
      url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
    });
    expect(denied.status).toBe(400);
    expect(denied.body.error.message).toMatch(/Anyone with the link/);
    remote.contentType = undefined;
  });

  it('REST/JSON: follows the records path and sends the bearer token once', async () => {
    remote.body = JSON.stringify({
      data: { students: [{ htno: '20DP1A0102', name: 'Irfan M', batch: 2024, nested: { x: 1 } }] },
    });
    remote.contentType = 'application/json';
    const r = await api(ctx, T.host, admin.token).post('/admin/imports/preview/remote').send({
      kind: 'rest',
      url: 'https://erp.example.edu/api/students',
      recordsPath: 'data.students',
      bearerToken: 'erp-token-123456',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.headers).toEqual(['htno', 'name', 'batch']);
    expect(remote.lastHeaders?.authorization).toBe('Bearer erp-token-123456');
    remote.contentType = undefined;
  });

  it('rejects non-https URLs at validation', async () => {
    const r = await api(ctx, T.host, admin.token)
      .post('/admin/imports/preview/remote')
      .send({ kind: 'rest', url: 'http://169.254.169.254/latest/meta-data' });
    expect(r.status).toBe(400);
  });
});

describe('whitelist management', () => {
  it('lists records with masked email only; manual add, duplicate and delete rules', async () => {
    const list = await api(ctx, T.host, admin.token).get('/admin/whitelist?q=21DP1A0501');
    expect(list.body.data[0].email).toBe('a••••••@dpit.ac.in');
    expect(JSON.stringify(list.body)).not.toContain('ananya.k@');
    const add = await api(ctx, T.host, admin.token).post('/admin/whitelist').send({
      rollNumber: '18dp1a0201',
      name: 'Jaya Lakshmi',
      kind: 'alumni',
      gradYear: 2022,
      email: 'jaya@example.org',
      sendInvite: true,
    });
    expect(add.status).toBe(201);
    expect(add.body.data.invited).toBe(1);
    expect(
      (
        await api(ctx, T.host, admin.token)
          .post('/admin/whitelist')
          .send({ rollNumber: '18DP1A0201', name: 'Again', kind: 'alumni' })
      ).status,
    ).toBe(409);
    expect((await api(ctx, T.host, admin.token).delete(`/admin/whitelist/${add.body.data.id}`)).status).toBe(
      204,
    );
    const claimed = await runInTenant(T._id, () => WhitelistModel.findOne({ status: 'claimed' }).lean());
    expect((await api(ctx, T.host, admin.token).delete(`/admin/whitelist/${claimed!._id}`)).status).toBe(400);
  });
});
