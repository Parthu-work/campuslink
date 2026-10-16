import { describe, expect, it } from 'vitest';
import { companyKey } from '../src/lib/company.js';
import {
  dedupeKey,
  extractSkills,
  freshersOk,
  inferBranches,
  inferLevel,
  inferMode,
  inferType,
  isIndiaLocation,
} from '../src/modules/jobs/normalize.js';
import { ADAPTERS } from '../src/modules/job-sources/adapters.js';
import { fakeFetcher } from './feed-fixtures.js';
import {
  adzunaResults,
  ashbyBoard,
  greenhouseBoard,
  leverBoard,
  smartRecruitersBoard,
} from './jobs-fixtures.js';

describe('company keys', () => {
  it('ignores legal forms, brackets, punctuation and case', () => {
    expect(companyKey('Infosys Ltd.')).toBe('infosys');
    expect(companyKey('INFOSYS LIMITED')).toBe('infosys');
    expect(companyKey('Nimbus Labs (demo)')).toBe('nimbus labs');
    expect(companyKey('Tata Consultancy Services Pvt. Ltd')).toBe('tata consultancy services');
    expect(companyKey('Procter & Gamble')).toBe('procter and gamble');
    expect(companyKey('Co')).toBe('co');
    expect(companyKey('   ')).toBe('');
  });
});

describe('inference', () => {
  it('mode, type and level', () => {
    expect(inferMode('Bengaluru (Hybrid)')).toBe('hybrid');
    expect(inferMode('Anywhere', null, true)).toBe('remote');
    expect(inferMode('Pune', 'on-site')).toBe('onsite');
    expect(inferMode('Pune')).toBeNull();
    expect(inferType('Software Engineer Intern', '')).toBe('internship');
    expect(inferType('QA Engineer', '', 'Contract')).toBe('contract');
    expect(inferType('Analyst', '')).toBe('full_time');
    expect(inferLevel('Graduate Engineer Trainee', '')).toBe('fresher');
    expect(inferLevel('Senior Backend Engineer', '')).toBe('senior');
    expect(inferLevel('Engineering Manager', '')).toBe('senior');
    expect(inferLevel('Software Engineer I', '')).toBe('junior');
    expect(inferLevel('Backend Engineer', 'You have 4+ years of experience')).toBe('mid');
    expect(inferLevel('Backend Engineer', '0-1 years')).toBe('fresher');
    expect(inferLevel('Backend Engineer', 'Great team')).toBeNull();
  });

  it('skills from a vocabulary, with ambiguous names only in clear forms', () => {
    expect(extractSkills('Java, Spring Boot, AWS and Kubernetes; REST APIs')).toEqual(
      expect.arrayContaining(['Java', 'Spring Boot', 'REST', 'AWS', 'Kubernetes']),
    );
    expect(extractSkills('Go to the office and C the results')).toEqual([]);
    expect(extractSkills('Golang services')).toEqual(['Go']);
    expect(extractSkills('C/C++ and embedded C')).toEqual(expect.arrayContaining(['C', 'C++', 'Embedded C']));
    expect(extractSkills('JavaScript only')).toEqual(['JavaScript']);
    expect(extractSkills('Node.js and Next.js')).toEqual(expect.arrayContaining(['Node.js', 'Next.js']));
  });

  it('branches, fresher friendliness, India and dedupe', () => {
    expect(inferBranches('VLSI Design Engineer', '')).toEqual(['ECE']);
    expect(inferBranches('Site Engineer', 'STAAD Pro', ['CIVIL'])).toEqual(['CIVIL']);
    expect(inferBranches('Backend Developer', '')).toEqual(expect.arrayContaining(['CSE', 'IT']));
    expect(freshersOk(null, 'full_time', 'Freshers welcome')).toBe(true);
    expect(freshersOk('senior', 'full_time', 'Lead the team')).toBe(false);
    expect(isIndiaLocation('Remote - India')).toBe(true);
    expect(isIndiaLocation('Gurgaon, Haryana')).toBe(true);
    expect(isIndiaLocation('Berlin, Germany')).toBe(false);
    expect(dedupeKey('Acme Pvt Ltd', 'Backend Engineer!', 'Hyderabad, India')).toBe(
      dedupeKey('ACME', 'backend engineer', 'hyderabad'),
    );
    expect(dedupeKey('Acme', 'Backend Engineer', 'Pune')).not.toBe(
      dedupeKey('Acme', 'Backend Engineer', 'Hyderabad'),
    );
  });
});

describe('adapters (recorded response shapes)', () => {
  const fake = fakeFetcher({
    'https://boards-api.greenhouse.io/v1/boards/acmedemo/jobs?content=true': {
      body: greenhouseBoard([{ id: 11, title: 'Java Developer', location: 'Hyderabad, India' }]),
      contentType: 'application/json',
    },
    'https://api.lever.co/v0/postings/betademo?mode=json': {
      body: leverBoard,
      contentType: 'application/json',
    },
    'https://api.ashbyhq.com/posting-api/job-board/gammademo?includeCompensation=true': {
      body: ashbyBoard,
      contentType: 'application/json',
    },
    'https://api.smartrecruiters.com/v1/companies/DeltaDemo/postings?limit=100': {
      body: smartRecruitersBoard,
      contentType: 'application/json',
    },
    'https://boards-api.greenhouse.io/v1/boards/missing/jobs?content=true': { status: 404 },
    'https://boards-api.greenhouse.io/v1/boards/slow/jobs?content=true': {
      status: 429,
      headers: { 'retry-after': '60' },
    },
    'https://boards-api.greenhouse.io/v1/boards/html/jobs?content=true': {
      body: '<html>',
      contentType: 'text/html',
    },
  });
  const ctx = { fetcher: fake.fn };

  it('greenhouse: decodes escaped HTML into plain text', async () => {
    const r = await ADAPTERS.greenhouse.fetch({ kind: 'greenhouse', board: 'acmedemo' }, ctx);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.jobs[0]).toMatchObject({
      externalId: '11',
      title: 'Java Developer',
      company: 'Acme Demo',
      location: 'Hyderabad, India',
      applyUrl: 'https://boards.greenhouse.io/acmedemo/jobs/11',
      description: 'Build APIs in Java and AWS. 0-1 years.',
    });
    expect(fake.calls.at(-1)?.headers['user-agent']).toMatch(/Bot\/1\.0/);
  });

  it('lever, ashby and smartrecruiters', async () => {
    const lv = await ADAPTERS.lever.fetch({ kind: 'lever', board: 'betademo' }, ctx);
    expect(lv.kind === 'ok' && lv.jobs[0]).toMatchObject({
      title: 'Software Engineer Intern',
      location: 'Hyderabad',
      workplace: 'hybrid',
      employment: 'Internship',
      salary: { min: 30000, max: 40000, currency: 'INR', period: 'month' },
    });
    const ab = await ADAPTERS.ashby.fetch({ kind: 'ashby', board: 'gammademo' }, ctx);
    expect(ab.kind === 'ok' && ab.jobs).toHaveLength(1);
    expect(ab.kind === 'ok' && ab.jobs[0]?.location).toBe('Bengaluru, Remote - India');
    const sr = await ADAPTERS.smartrecruiters.fetch({ kind: 'smartrecruiters', board: 'DeltaDemo' }, ctx);
    expect(sr.kind === 'ok' && sr.jobs[0]).toMatchObject({
      title: 'Graduate Engineer Trainee - Mechanical',
      company: 'Delta Demo',
      location: 'Chennai, TN, India',
      applyUrl: 'https://jobs.smartrecruiters.com/DeltaDemo/744000000001',
    });
  });

  it('adzuna needs keys and carries attribution', async () => {
    expect(await ADAPTERS.adzuna.fetch({ kind: 'adzuna', query: 'qa' }, ctx)).toMatchObject({
      kind: 'blocked',
    });
    const url =
      'https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=id&app_key=key&results_per_page=50&what=qa&max_days_old=21&content-type=application%2Fjson&where=Hyderabad';
    const f2 = fakeFetcher({ [url]: { body: adzunaResults, contentType: 'application/json' } });
    const r = await ADAPTERS.adzuna.fetch(
      { kind: 'adzuna', query: 'qa', where: 'Hyderabad' },
      { fetcher: f2.fn, adzuna: { appId: 'id', appKey: 'key' } },
    );
    expect(r.kind === 'ok' && r.jobs[0]).toMatchObject({
      title: 'Junior QA Engineer',
      company: 'Epsilon Demo',
      salary: { min: 300000, max: 450000 },
    });
    expect(ADAPTERS.adzuna.attribution).toBe('Jobs by Adzuna');
  });

  it('reports missing boards, rate limits and non-JSON answers', async () => {
    expect(await ADAPTERS.greenhouse.fetch({ kind: 'greenhouse', board: 'missing' }, ctx)).toMatchObject({
      kind: 'error',
      message: 'Board not found (check the name)',
    });
    expect(await ADAPTERS.greenhouse.fetch({ kind: 'greenhouse', board: 'slow' }, ctx)).toMatchObject({
      kind: 'error',
      retryAfterSec: 300,
    });
    expect(await ADAPTERS.greenhouse.fetch({ kind: 'greenhouse', board: 'html' }, ctx)).toMatchObject({
      kind: 'error',
    });
    expect(await ADAPTERS.greenhouse.fetch({ kind: 'greenhouse', board: 'unreachable' }, ctx)).toMatchObject({
      kind: 'error',
    });
  });

  it('board names are URL-encoded', () => {
    expect(ADAPTERS.lever.target({ kind: 'lever', board: 'acme' })).toBe('jobs.lever.co/acme');
  });
});
