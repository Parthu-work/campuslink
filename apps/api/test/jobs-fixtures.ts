import { PDFDocument } from 'pdf-lib';
import { api, type TestTenant, type TestUser, type testApp } from './helpers.js';

type Ctx = ReturnType<typeof testApp>;

/**
 * Listing dates relative to now: sources keep only recent openings (Adzuna asks for the last 21
 * days), so fixed dates made these tests fail once the calendar moved past them.
 */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Response shapes of the public job-board APIs (fields we read; values are fictional). */
export const greenhouseBoard = (jobs: { id: number; title: string; location: string; content?: string }[]) =>
  JSON.stringify({
    jobs: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      updated_at: daysAgo(1).toISOString(),
      first_published: daysAgo(2).toISOString(),
      location: { name: j.location },
      absolute_url: `https://boards.greenhouse.io/acmedemo/jobs/${j.id}`,
      content: j.content ?? '&lt;p&gt;Build &lt;b&gt;APIs&lt;/b&gt; in Java and AWS. 0-1 years.&lt;/p&gt;',
      company_name: 'Acme Demo',
    })),
    meta: { total: jobs.length },
  });

export const leverBoard = JSON.stringify([
  {
    id: 'lv-1',
    text: 'Software Engineer Intern',
    categories: {
      location: 'Hyderabad',
      commitment: 'Internship',
      team: 'Engineering',
      allLocations: ['Hyderabad'],
    },
    hostedUrl: 'https://jobs.lever.co/betademo/lv-1',
    applyUrl: 'https://jobs.lever.co/betademo/lv-1/apply',
    createdAt: daysAgo(3).getTime(),
    descriptionPlain: 'Work with React and Node.js. Freshers welcome.',
    workplaceType: 'hybrid',
    salaryRange: { min: 30000, max: 40000, currency: 'inr', interval: 'per-month-salary' },
  },
  {
    id: 'lv-2',
    text: 'Senior Data Engineer',
    categories: { location: 'Berlin', commitment: 'Full-time' },
    hostedUrl: 'https://jobs.lever.co/betademo/lv-2',
    createdAt: daysAgo(3).getTime(),
    descriptionPlain: 'Spark and Airflow.',
    workplaceType: 'onsite',
  },
]);

export const ashbyBoard = JSON.stringify({
  apiVersion: '1',
  jobs: [
    {
      id: 'ab-1',
      title: 'Backend Engineer',
      location: 'Bengaluru',
      secondaryLocations: [{ location: 'Remote - India' }],
      isRemote: false,
      workplaceType: 'Hybrid',
      employmentType: 'FullTime',
      publishedAt: daysAgo(4).toISOString(),
      jobUrl: 'https://jobs.ashbyhq.com/gammademo/ab-1',
      applyUrl: 'https://jobs.ashbyhq.com/gammademo/ab-1/application',
      descriptionPlain: 'Go and PostgreSQL. 2+ years of experience.',
      isListed: true,
    },
    {
      id: 'ab-2',
      title: 'Hidden role',
      location: 'Pune',
      jobUrl: 'https://jobs.ashbyhq.com/gammademo/ab-2',
      isListed: false,
    },
  ],
});

export const smartRecruitersBoard = JSON.stringify({
  offset: 0,
  limit: 100,
  totalFound: 1,
  content: [
    {
      id: '744000000001',
      name: 'Graduate Engineer Trainee - Mechanical',
      releasedDate: daysAgo(5).toISOString(),
      location: { city: 'Chennai', region: 'TN', country: 'in', remote: false },
      experienceLevel: { id: 'entry_level', label: 'Entry Level' },
      typeOfEmployment: { label: 'Full-time' },
      function: { label: 'Engineering' },
      department: { label: 'Manufacturing' },
      company: { identifier: 'DeltaDemo', name: 'Delta Demo' },
    },
  ],
});

export const adzunaResults = JSON.stringify({
  count: 1,
  results: [
    {
      id: '4400001',
      title: '<strong>Junior</strong> QA Engineer',
      company: { display_name: 'Epsilon Demo' },
      location: { display_name: 'Hyderabad, Telangana' },
      redirect_url: 'https://www.adzuna.in/land/ad/4400001',
      created: daysAgo(6).toISOString(),
      description: 'Manual Testing and Selenium. Freshers can apply.',
      salary_min: 300000,
      salary_max: 450000,
      salary_is_predicted: '0',
      contract_time: 'full_time',
    },
  ],
});

/** A tiny real PDF (rebuilt by the server like chat PDFs). */
export async function tinyPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setAuthor('SECRET-AUTHOR-NAME');
  doc.addPage([200, 200]).drawText('Resume (demo)');
  return Buffer.from(await doc.save());
}

export async function postJob(ctx: Ctx, t: TestTenant, u: TestUser, over: Record<string, unknown> = {}) {
  const r = await api(ctx, t.host, u.token)
    .post('/jobs')
    .send({
      title: 'Backend Developer',
      company: 'Nimbus Labs',
      location: 'Hyderabad',
      mode: 'hybrid',
      type: 'full_time',
      level: 'fresher',
      skills: ['Java', 'SQL'],
      branches: ['CSE'],
      applyUrl: 'https://careers.nimbus.example/jobs/1',
      description: 'Build and run REST APIs for our payments product. Freshers with Java basics welcome.',
      ...over,
    });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body.data as { id: string; [k: string]: unknown };
}

/** Puts an alumnus at a company and opts them in to referrals. */
export async function makeReferrer(ctx: Ctx, t: TestTenant, u: TestUser, company: string, cap = 3) {
  const a = api(ctx, t.host, u.token);
  const p = await a.put('/me/profile').send({ company, jobTitle: 'SDE 2' });
  if (p.status !== 200) throw new Error(JSON.stringify(p.body));
  const s = await a.put('/me/referral-settings').send({ accepting: true, weeklyCap: cap });
  if (s.status !== 200) throw new Error(JSON.stringify(s.body));
}
