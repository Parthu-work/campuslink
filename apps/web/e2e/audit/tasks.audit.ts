import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { signIn, START } from '../helpers';
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

/**
 * Prompt 3, U11: `KEYBOARD=1` walks the same tasks with the keyboard alone. Each control is reached
 * the way a keyboard user reaches it, by Tab (then Shift+Tab) from wherever focus is, and pressed
 * with Enter (Space for a checkbox, radio or switch); fields are typed into once reached. A control
 * Tab cannot reach fails the task. Key presses are counted (`keys`) and written to
 * `tasks-keyboard.json`.
 */
const KEYBOARD = process.env.KEYBOARD === '1';
const MAX_TABS = 150;

/** The task being counted, so a failure can say which step and what was on screen. */
let current: Count | null = null;

class Count {
  taps = 0;
  fields = 0;
  keys = 0;
  log: string[] = [];
  pending = '';
  constructor(readonly page: Page) {}
  /**
   * Keyboard mode: Tab (then Shift+Tab) until the control, or something inside it, has focus. A
   * radio is one Tab stop for its whole group (the checked one, or the first), and the arrow keys
   * move within it, as the WAI-ARIA radio group pattern and native radios both work: so for a
   * radio, Tab reaches the group and the arrows the option.
   */
  private async reach(target: Locator) {
    await target.waitFor();
    const focused = () =>
      target.evaluate((el) => el === document.activeElement || el.contains(document.activeElement));
    const radio = await target.evaluate(
      (el) => el.getAttribute('role') === 'radio' || (el as HTMLInputElement).type === 'radio',
    );
    // For a radio: is focus on any option of the same group?
    const inGroup = () =>
      target.evaluate((el) => {
        const a = document.activeElement;
        if (!a) return false;
        if (el instanceof HTMLInputElement && a instanceof HTMLInputElement && el.type === 'radio')
          return a.type === 'radio' && a.name === el.name && a.form === el.form;
        const group = el.closest('[role=radiogroup]');
        return !!group && group.contains(a);
      });
    const arrived = radio ? inGroup : focused;
    let found = false;
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < MAX_TABS && !found; i++) {
        if (await arrived().catch(() => false)) found = true;
        else {
          await this.page.keyboard.press(key);
          this.keys += 1;
        }
      }
      if (found) break;
    }
    if (!found) throw new Error(`keyboard: Tab never reached "${this.pending}"`);
    if (!radio) return;
    for (let i = 0; i < 20; i++) {
      if (await focused().catch(() => false)) return;
      await this.page.keyboard.press('ArrowDown');
      this.keys += 1;
    }
    throw new Error(`keyboard: the arrow keys never reached "${this.pending}"`);
  }
  /** Keyboard mode: reach the control, then press it as its kind is pressed. */
  private async press(target: Locator) {
    if (!KEYBOARD) return target.click();
    await this.reach(target);
    const toggle = await target.evaluate((el) =>
      /^(checkbox|radio|switch)$/.test(el.getAttribute('role') ?? (el as HTMLInputElement).type ?? ''),
    );
    await this.page.keyboard.press(toggle ? 'Space' : 'Enter');
    this.keys += 1;
  }
  async tap(target: Locator, what: string) {
    this.pending = what;
    await this.press(target);
    this.taps += 1;
    this.log.push(`tap ${what}`);
  }
  async fill(target: Locator, value: string, what: string) {
    this.pending = what;
    if (KEYBOARD) {
      await this.reach(target);
      await this.page.keyboard.press('ControlOrMeta+A');
      await this.page.keyboard.type(value);
      this.keys += 1 + value.length;
    } else {
      await target.click();
      await target.fill(value);
    }
    this.taps += 1;
    this.fields += 1;
    this.log.push(`field ${what}`);
  }
  async select(target: Locator, option: Parameters<Locator['selectOption']>[0], what: string) {
    this.pending = what;
    // A native select is chosen from the keyboard with the arrow keys once focused; reaching it is
    // what the keyboard path has to prove.
    if (KEYBOARD) await this.reach(target);
    await target.selectOption(option);
    this.taps += 2;
    this.fields += 1;
    this.log.push(`select ${what}`);
  }
  async choose(target: Locator, what: string) {
    this.pending = what;
    await this.press(target);
    this.taps += 1;
    this.fields += 1;
    this.log.push(`choose ${what}`);
  }
  async code(first: Locator, code: string, what: string) {
    this.pending = what;
    if (KEYBOARD) await this.reach(first);
    else await first.click();
    await this.page.keyboard.type(code);
    this.keys += code.length;
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
  /** Keyboard mode: key presses (Tab, Enter, Space and the characters typed). */
  keys?: number | null;
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
  await page.waitForURL(START);
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
        // Prompt 3, U4: three steps (number, about you, code).
        await c.fill(page.getByLabel('Mobile number'), number, 'mobile number');
        await c.tap(page.getByRole('button', { name: 'Continue' }), 'continue');
        await c.fill(page.getByLabel('Full name'), 'Task Student (demo)', 'name');
        await c.select(page.getByLabel('Month'), { label: 'June' }, 'birth month');
        await c.select(page.getByLabel('Year'), String(new Date().getFullYear() - 20), 'birth year');
        await c.tap(page.getByRole('button', { name: 'Send code' }), 'send code');
        await c.code(page.getByLabel('6-digit code 1'), await smsCode(page, `+91${number}`), 'WhatsApp code');
        await page.waitForURL(START);
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
        // Prompt 3, U6: what you need, your goal (two short answers), then when.
        await c.choose(sheet.getByRole('radio', { name: /Mock interview/ }), 'mock interview');
        await c.tap(sheet.getByRole('button', { name: 'Continue' }), 'continue');
        await c.fill(
          sheet.getByLabel('What are you working towards?'),
          'a backend role at a product company',
          'goal',
        );
        await c.fill(sheet.getByLabel('What would help most?'), 'a practice round with feedback', 'need');
        await c.tap(sheet.getByRole('button', { name: 'Continue' }), 'continue');
        // A mock interview has a slot: the day is preselected, a time is the member's choice.
        await c.choose(sheet.getByRole('radiogroup', { name: 'Time' }).getByRole('radio').first(), 'time');
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
        // A final-year student opens on Placements (U2), where each eligible drive's card registers
        // in one tap (U7); a drive with questions opens its page with the form (a link, not a button).
        if (!/\/placements$/.test(page.url()))
          await c.tap(page.getByRole('link', { name: 'Placements', exact: true }).last(), 'Placements');
        const main = page.getByRole('main');
        await c.tap(
          main
            .getByRole('button', { name: /^Register for/ })
            .or(main.getByRole('link', { name: /^Register for/ }))
            .first(),
          'register on the card',
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
        // A final-year student opens on Career (U2): Home is a tap away. Home's next-step card opens
        // the step itself (U3), so Mark done is the next tap.
        if (!/\/home$/.test(page.url()))
          await c.tap(page.locator('nav.chrome-bottom > a[href="/home"]'), 'Home tab');
        // "Next on <path>": the Today card when the step is the week's most urgent thing, else the
        // step's row in Your next steps (U5); either opens the step itself.
        await c.tap(page.getByRole('link', { name: /Next on/ }).first(), 'the next step on Home');
        await c.tap(page.getByRole('dialog').getByRole('button', { name: 'Mark done' }), 'mark as done');
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
        // Study lives in the Learn space (U2): its tab, then the Study section.
        await c.tap(
          page
            .getByRole('navigation', { name: 'Main' })
            .getByRole('link', { name: 'Learn', exact: true })
            .last(),
          'Learn tab',
        );
        await c.tap(page.getByRole('link', { name: 'Study', exact: true }).first(), 'Study');
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
        // Prompt 3, U9: staff open on Today, where the students who have not joined are a row with
        // its one action; anywhere else, Today is the first tab.
        if (!/\/admin$/.test(page.url()))
          await c.tap(
            page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).last(),
            'Today',
          );
        await c.tap(
          page
            .getByRole('listitem')
            .filter({ hasText: /joined yet/ })
            .getByRole('link', { name: 'Invite' }),
          'invite (not joined)',
        );
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
      rows.push({
        task: t.name,
        taps: count.taps,
        fields: count.fields,
        ...(KEYBOARD ? { keys: count.keys } : {}),
        steps: count.log,
        error: null,
      });
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
  if (!KEYBOARD) rows.push(TASK_G);
  mkdirSync(DATA, { recursive: true });
  writeFileSync(
    join(DATA, KEYBOARD ? 'tasks-keyboard.json' : 'tasks.json'),
    `${JSON.stringify(rows, null, 1)}\n`,
  );
  for (const r of rows)
    console.warn(
      `${r.task}: ${r.taps ?? '—'} taps, ${r.fields ?? '—'} fields${KEYBOARD ? `, ${r.keys ?? '—'} keys` : ''}${r.error ? ` (${r.error})` : ''}`,
    );
  // Prompt 3, U11: every journey can be finished with the keyboard alone.
  if (KEYBOARD) expect(rows.filter((r) => r.error).map((r) => `${r.task}: ${r.error}`)).toEqual([]);
});
