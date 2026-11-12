import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { signIn } from '../helpers';
import { lastMailSubject } from '../admin';

/**
 * Prompt 3, U0.2 (and U13 again): taps and fields for seven tasks on a phone, from a cold start of
 * the installed app (its start URL, `/`), moving only by what is on screen.
 *
 * Counting: a tap is one press on a control (a native select is two: open, choose); a field is one
 * value the member enters or picks (text, a choice, a select, a one-time code). Tapping into a text
 * field is a tap and filling it a field. A one-time code is one tap and one field (Android offers it
 * from the message). Waiting is not counted. (g) happens in WhatsApp, not in the app: see `TASK_G`.
 */
const OUT = process.env.AUDIT_OUT ?? 'audit-out';
const DATA = join(OUT, 'data-after');
const BASE = 'http://dpit.localhost:4173';

/** The task being counted, so a failure can say which step and what was on screen. */
let current: Count | null = null;

class Count {
  taps = 0;
  fields = 0;
  log: string[] = [];
  pending = '';
  constructor(readonly page: Page) {}
  async tap(target: Locator, what: string) {
    this.pending = what;
    await target.click();
    this.taps += 1;
    this.log.push(`tap ${what}`);
  }
  async fill(target: Locator, value: string, what: string) {
    this.pending = what;
    await target.click();
    await target.fill(value);
    this.taps += 1;
    this.fields += 1;
    this.log.push(`field ${what}`);
  }
  async select(target: Locator, option: Parameters<Locator['selectOption']>[0], what: string) {
    this.pending = what;
    await target.selectOption(option);
    this.taps += 2;
    this.fields += 1;
    this.log.push(`select ${what}`);
  }
  async choose(target: Locator, what: string) {
    this.pending = what;
    await target.click();
    this.taps += 1;
    this.fields += 1;
    this.log.push(`choose ${what}`);
  }
  async code(first: Locator, code: string, what: string) {
    this.pending = what;
    await first.click();
    await this.page.keyboard.type(code);
    this.taps += 1;
    this.fields += 1;
    this.log.push(`code ${what}`);
  }
}

/** A counter for one task, remembered as the current one. */
const count = (page: Page) => {
  current = new Count(page);
  return current;
};

interface TaskResult {
  task: string;
  taps: number | null;
  fields: number | null;
  steps: string[];
  error: string | null;
}

const phone = async (browser: Browser) => {
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  return { ctx, page: await ctx.newPage() };
};

/** A member who is already signed in (the installed app keeps the session); then a cold start. */
async function coldStart(browser: Browser, email: string) {
  const { ctx, page } = await phone(browser);
  await signIn(page, email);
  await page.goto(`${BASE}/`);
  await page.waitForURL(/\/home$/);
  // The member looks before tapping: the tabs and Home's own content have arrived.
  // (Not "network idle": the app keeps its live connection open.)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link').first().waitFor();
  await page.getByRole('main').getByRole('link').first().waitFor();
  await page.waitForTimeout(1500);
  return { ctx, page };
}

const outbox = (page: Page, to: string) =>
  page.evaluate(
    async (n) =>
      (
        (await (await fetch(`/api/v1/dev/outbox?to=${encodeURIComponent(n)}`)).json()) as {
          data: { params: string[] }[];
        }
      ).data,
    to,
  );

async function smsCode(page: Page, to: string) {
  for (let i = 0; i < 40; i++) {
    const code = (await outbox(page, to))[0]?.params[0];
    if (code) return code;
    await page.waitForTimeout(250);
  }
  throw new Error(`no code for ${to}`);
}

const tasks: { name: string; run: (b: Browser) => Promise<{ count: Count; close: () => Promise<void> }> }[] =
  [
    {
      name: 'a · a new student signs up and is verified',
      run: async (browser) => {
        const { ctx, page } = await phone(browser);
        const c = count(page);
        const number = `9${String(Date.now()).slice(-9)}`;
        await page.goto(`${BASE}/`);
        await c.tap(page.getByRole('link', { name: /sign up|join|get started/i }).first(), 'sign up');
        await c.fill(page.getByLabel('Full name'), 'Task Student (demo)', 'name');
        await c.fill(page.getByLabel('Mobile number'), number, 'mobile number');
        await c.select(page.getByLabel('Month'), { label: 'June' }, 'birth month');
        await c.select(page.getByLabel('Year'), String(new Date().getFullYear() - 20), 'birth year');
        await c.tap(page.getByRole('button', { name: 'Send code' }), 'send code');
        await c.code(page.getByLabel('6-digit code 1'), await smsCode(page, `+91${number}`), 'WhatsApp code');
        await page.waitForURL(/\/home$/);
        await c.tap(page.getByRole('link', { name: 'Verify now' }).first(), 'verify now');
        await c.fill(page.getByLabel('Roll number'), '24DP1A0577', 'roll number');
        await c.tap(page.getByRole('button', { name: 'Find me' }), 'find me');
        const subject = await lastMailSubject('sai.teja.records@dpit.example');
        await c.code(
          page.getByLabel('Enter the code 1'),
          /\b(\d{6})\b/.exec(subject)?.[1] ?? '',
          'email code',
        );
        await expect(page.getByRole('heading', { name: 'You’re in!' })).toBeVisible();
        return { count: c, close: () => ctx.close() };
      },
    },
    {
      name: 'b · a student asks an alumnus for a mock interview',
      run: async (browser) => {
        const { ctx, page } = await coldStart(browser, 'ananya@dpit.example');
        const c = count(page);
        await c.tap(page.getByRole('link', { name: 'Mentors', exact: true }).last(), 'Mentors tab');
        // Alumni Match shows one person at a time; the list that filters by session type is Browse.
        await c.tap(page.getByRole('button', { name: 'Browse', exact: true }), 'Browse');
        await c.select(
          page.getByRole('main').getByRole('combobox').first(),
          { label: 'Mock interview' },
          'type',
        );
        await c.tap(page.getByRole('main').getByRole('link', { name: /Batch/ }).first(), 'a mentor');
        await c.tap(page.getByRole('button', { name: 'Request mentorship' }), 'request');
        const sheet = page.getByRole('dialog');
        await c.choose(sheet.getByRole('radio', { name: /Mock interview/ }), 'mock interview');
        // A mock interview has a slot: the day is preselected, a time is the member's choice.
        await c.choose(sheet.getByRole('radiogroup', { name: 'Time' }).getByRole('radio').first(), 'time');
        await c.tap(sheet.getByRole('button', { name: 'Continue' }), 'continue');
        await c.tap(sheet.getByRole('button', { name: 'Goal' }), 'goal starter');
        await page.keyboard.type('practise for product company interviews.');
        c.fields += 1;
        c.log.push('field goal');
        await c.tap(page.getByRole('button', { name: 'Send request' }), 'send');
        await expect(page.getByRole('heading', { name: 'Request sent' })).toBeVisible();
        return { count: c, close: () => ctx.close() };
      },
    },
    {
      name: 'c · a student registers for an eligible drive',
      run: async (browser) => {
        const { ctx, page } = await coldStart(browser, 'ananya@dpit.example');
        const c = count(page);
        // Home's next-step card names the drive (the shortest path on screen); else the Placements tab.
        const card = page.getByRole('link', { name: /A drive you can register for/ }).first();
        if (await card.isVisible().catch(() => false)) await c.tap(card, 'drive card on Home');
        else {
          await c.tap(page.getByRole('link', { name: 'Placements', exact: true }).last(), 'Placements tab');
          await c.tap(page.getByRole('main').getByRole('link', { name: /DEMO/ }).first(), 'an open drive');
        }
        await c.tap(
          page
            .getByRole('main')
            .getByRole('button', { name: /^Register/ })
            .first(),
          'register',
        );
        // The company's questions, if the drive has any (each a select here), then Register.
        const dialog = page.getByRole('dialog');
        if (await dialog.isVisible().catch(() => false)) {
          const asks = dialog.getByRole('combobox');
          for (let i = 0; i < (await asks.count()); i++)
            await c.select(asks.nth(i), { index: 1 }, 'drive question');
          await c.tap(dialog.getByRole('button', { name: /^Register/ }), 'confirm');
        }
        await expect(page.getByText(/You are registered|Registered/).first()).toBeVisible();
        return { count: c, close: () => ctx.close() };
      },
    },
    {
      name: 'd · a student marks the next roadmap step done',
      run: async (browser) => {
        const { ctx, page } = await coldStart(browser, 'ananya@dpit.example');
        const c = count(page);
        // Home's next-step card opens the followed roadmap; the next step is the first numbered one.
        await c.tap(page.getByRole('link', { name: /^Next on/ }).first(), 'next-step card on Home');
        const steps = page.getByRole('main').getByRole('button', { name: / about \d+–\d+ h/ });
        await c.tap(steps.filter({ hasNotText: 'Done' }).first(), 'the next step');
        await c.tap(page.getByRole('dialog').getByRole('button', { name: 'Mark as done' }), 'mark as done');
        await expect(
          page.getByRole('dialog').getByRole('button', { name: 'Mark as not done' }),
        ).toBeVisible();
        return { count: c, close: () => ctx.close() };
      },
    },
    {
      name: 'e · a student asks the assistant a question and opens a source',
      run: async (browser) => {
        const { ctx, page } = await coldStart(browser, 'ananya@dpit.example');
        const c = count(page);
        await c.tap(page.getByRole('link', { name: 'Study', exact: true }).last(), 'Study tab');
        await c.fill(page.getByPlaceholder('Search by name or code'), 'Formal Languages', 'search');
        await c.tap(
          page.getByRole('link', { name: /Formal Languages and Automata Theory/ }).first(),
          'subject',
        );
        await c.tap(page.getByRole('button', { name: 'Ask', exact: true }), 'ask');
        const chat = page.getByRole('dialog', { name: 'Study assistant' });
        await c.fill(
          chat.getByRole('combobox', { name: 'Your question' }),
          'What does the pumping lemma show?',
          'question',
        );
        await c.tap(chat.getByRole('button', { name: 'Send' }), 'send');
        const source = chat.getByRole('link', { name: /DEMO notes/ }).first();
        await expect(source).toBeVisible({ timeout: 20_000 });
        await c.tap(source, 'source');
        await page.waitForURL(/\/m\/[a-f0-9]{24}\?page=/);
        return { count: c, close: () => ctx.close() };
      },
    },
    {
      name: 'f · a TPO sees who has not joined and nudges them',
      run: async (browser) => {
        const { ctx, page } = await coldStart(browser, 'tpo@dpit.example');
        const c = count(page);
        const admin = page.getByRole('link', { name: 'Admin', exact: true }).last();
        if (await admin.isVisible()) await c.tap(admin, 'Admin tab');
        else {
          await c.tap(page.getByRole('button', { name: /Account menu/ }), 'account menu');
          await c.tap(page.getByRole('link', { name: 'Admin', exact: true }).last(), 'Admin');
        }
        await c.tap(page.getByRole('link', { name: /Not joined yet/ }).first(), 'not joined');
        await c.tap(page.getByRole('button', { name: 'Nudge' }).first(), 'nudge');
        // Messages on WhatsApp need the college's word that the students agreed (one tick), then Send.
        const dialog = page.getByRole('dialog');
        const consent = dialog.getByRole('checkbox').first();
        if (await consent.isVisible().catch(() => false)) await c.choose(consent, 'consent');
        await c.tap(dialog.getByRole('button', { name: /^Send/ }), 'send');
        await expect(dialog).toBeHidden();
        return { count: c, close: () => ctx.close() };
      },
    },
  ];

/** (g) is answered inside WhatsApp: the request message's Accept quick reply (B3, `request_accept`). */
const TASK_G: TaskResult = {
  task: 'g · an alumnus accepts a request from WhatsApp',
  taps: 2,
  fields: 0,
  steps: ['tap the WhatsApp notification', 'tap Accept (quick reply; the app is not opened)'],
  error: null,
};

test.describe.configure({ mode: 'serial' });
test.setTimeout(0);

test('tasks: taps and fields (U0.2)', async ({ browser }) => {
  const rows: TaskResult[] = [];
  // TASKS=b,d runs only those (while fixing a path); the file then holds only those rows.
  const only = process.env.TASKS?.split(',');
  for (const t of tasks) {
    if (only && !only.includes(t.name[0] ?? '')) continue;
    current = null;
    try {
      const { count, close } = await t.run(browser);
      rows.push({ task: t.name, taps: count.taps, fields: count.fields, steps: count.log, error: null });
      await close();
    } catch (e) {
      const c = current as Count | null;
      // What was on screen when the step failed: the path and the controls' names.
      const seen = c
        ? await c.page
            .evaluate(() => {
              const names = [
                ...document.querySelectorAll('main a, main button, nav a, nav button, [role=dialog] button'),
              ]
                .map((el) =>
                  (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim(),
                )
                .filter(Boolean)
                .slice(0, 30);
              return `${location.pathname}: ${names.join(' | ')}`;
            })
            .catch(() => '')
        : '';
      // The first line and Playwright's last call-log lines (what the click was waiting for).
      const lines = (e instanceof Error ? e.message : String(e)).split('\n').filter((l) => l.trim());
      const message = [lines[0], ...lines.slice(1).slice(-4)].join(' / ');
      rows.push({
        task: t.name,
        taps: null,
        fields: null,
        steps: c?.log ?? [],
        error: `at "${c?.pending ?? '?'}": ${message}. On screen: ${seen}`,
      });
      await c?.page
        .context()
        .close()
        .catch(() => undefined);
    }
  }
  rows.push(TASK_G);
  mkdirSync(DATA, { recursive: true });
  writeFileSync(join(DATA, 'tasks.json'), `${JSON.stringify(rows, null, 1)}\n`);
  for (const r of rows)
    console.warn(
      `${r.task}: ${r.taps ?? '—'} taps, ${r.fields ?? '—'} fields${r.error ? ` (${r.error})` : ''}`,
    );
});
