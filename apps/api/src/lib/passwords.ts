import argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';

const zxcvbn = new ZxcvbnFactory({
  dictionary: { ...common.dictionary, ...en.dictionary },
  graphs: common.adjacencyGraphs,
  translations: en.translations,
});

/** OWASP-recommended argon2id parameters (19 MiB, t=2, p=1) — tuned for small cloud instances. */
const ARGON = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string): Promise<string> => argon2.hash(plain, ARGON);
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
/** Pre-computed hash used to keep timing equal when an account does not exist. */
let dummyHash: Promise<string> | undefined;
export const dummyVerify = async (plain: string): Promise<void> => {
  dummyHash ??= hashPassword('campuslink-timing-equaliser');
  await verifyPassword(await dummyHash, plain);
};

export interface StrengthResult {
  ok: boolean;
  feedback: string[];
}
/** Expand personal inputs so "DPIT College" also catches "dpitcollege" and "dpit", and emails their local part. */
function expandInputs(inputs: string[]): string[] {
  const out = new Set<string>();
  for (const raw of inputs.filter(Boolean)) {
    const v = raw.toLowerCase();
    const local = v.split('@')[0] ?? v;
    const parts = local.split(/[^a-z0-9]+/).filter((p) => p.length >= 3);
    [v, local, local.replace(/[^a-z0-9]/g, ''), ...parts].forEach((x) => x && out.add(x));
  }
  return [...out];
}

export function checkStrength(plain: string, userInputs: string[]): StrengthResult {
  const r = zxcvbn.check(plain, expandInputs(userInputs));
  const feedback = [r.feedback.warning, ...r.feedback.suggestions].filter((s): s is string => !!s);
  return {
    ok: r.score >= 3,
    feedback: feedback.length ? feedback : ['Use a longer passphrase with uncommon words.'],
  };
}

/**
 * HIBP k-anonymity range check: only the first 5 hex chars of the SHA-1 leave the server.
 * Fails open (returns false) on any network problem so sign-up never depends on a third party.
 */
export async function isBreached(plain: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const sha1 = createHash('sha1').update(plain).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5),
    suffix = sha1.slice(5);
  try {
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'campuslink-password-check' },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split('\n').some((line) => {
      const [hash, count] = line.trim().split(':');
      return hash === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}
