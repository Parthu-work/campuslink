import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { generate } from 'otplib';
import { PASSWORD } from './helpers';

/**
 * Admins must use TOTP. Tests in different projects share one seeded database, so the first sign-in
 * enrols and stores the secret; later sign-ins reuse it. Codes are single-use per 30 s step
 * (replay protection), so we wait for a fresh step when needed.
 */
const STORE = 'test-results/.admin-totp.json';
type Saved = Record<string, { secret: string; step: number }>;
const load = (): Saved => {
  try {
    return JSON.parse(readFileSync(STORE, 'utf8')) as Saved;
  } catch {
    return {};
  }
};
const save = (email: string, secret: string) => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    STORE,
    JSON.stringify({ ...load(), [email]: { secret, step: Math.floor(Date.now() / 30_000) } }),
  );
};

async function freshCode(email: string, secret: string): Promise<string> {
  const used = load()[email]?.step ?? 0;
  while (Math.floor(Date.now() / 30_000) <= used) await new Promise((r) => setTimeout(r, 1000));
  save(email, secret);
  return generate({ secret });
}

export async function adminSignIn(page: Page, host: string, email: string) {
  await page.goto(`http://${host}.localhost:4173/sign-in`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const enrol = page.getByRole('heading', { name: 'Turn on two-factor authentication' });
  const prompt = page.getByRole('heading', { name: 'Enter your 6-digit code' });
  await expect(enrol.or(prompt)).toBeVisible();
  if (await enrol.isVisible()) {
    const secret = (await page.locator('code').innerText()).replace(/\s/g, '');
    save(email, secret);
    await page.getByLabel('Enter your 6-digit code 1').click();
    await page.keyboard.type(await generate({ secret }));
    await page.getByRole('button', { name: 'Turn on 2FA' }).click();
    await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
    await page.getByRole('button', { name: 'I’ve saved these codes' }).click();
  } else {
    const saved = load()[email];
    if (!saved) throw new Error(`No stored TOTP secret for ${email}; reseed the database`);
    await page.getByLabel('Enter your 6-digit code 1').click();
    await page.keyboard.type(await freshCode(email, saved.secret));
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  await page.waitForURL(/\/(home|platform)$/);
}

/** Latest email to `to` from Mailpit (dev SMTP sink): returns the subject. */
export async function lastMailSubject(to: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(
      `http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`,
    );
    const body = (await res.json()) as { messages?: { Subject: string }[] };
    if (body.messages?.[0]) return body.messages[0].Subject;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email for ${to}`);
}
