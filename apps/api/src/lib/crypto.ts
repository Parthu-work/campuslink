import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Opaque, URL-safe random token (default 256 bits). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('base64url');
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a),
    bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Application-level field encryption (AES-256-GCM) for sensitive personal data such as phone
 * numbers, TOTP secrets and message bodies, with key rotation.
 *
 * Format: `v2.<keyId>.<iv>.<tag>.<ciphertext>` (base64url). The key id is a hash prefix of the key
 * (it reveals nothing about the key) and is bound to the ciphertext as additional authenticated
 * data, so a value cannot be relabelled to another key. Legacy `v1.<iv>.<tag>.<ciphertext>` values
 * (written before rotation existed) carry no key id; they decrypt with whichever configured key
 * authenticates them, and `needsRotation()` reports them.
 *
 * Key ring: the current key encrypts; previous keys (FIELD_ENCRYPTION_KEYS_PREVIOUS) only decrypt,
 * until `pnpm --filter @campuslink/api rotate-field-key` has re-encrypted everything (runbook).
 *
 * Blind indexes (deterministic HMACs for equality lookups) are derived per key. Writes store the
 * current key's index; lookups match any configured key's index (`blindIndexes`) so records not yet
 * re-indexed are still found during a rotation.
 */
interface RingKey {
  id: string;
  key: Buffer;
  indexKey: Buffer;
}

const keyIdOf = (key: Buffer) =>
  createHash('sha256').update(key).digest().subarray(0, 6).toString('base64url');

function ringKey(base64Key: string, name: string): RingKey {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes`);
  return { id: keyIdOf(key), key, indexKey: createHmac('sha256', key).update('blind-index-v1').digest() };
}

export class FieldCipher {
  private readonly current: RingKey;
  private readonly previous: RingKey[];
  private readonly byId: Map<string, RingKey>;

  constructor(currentKey: string, previousKeys: string[] = []) {
    this.current = ringKey(currentKey, 'FIELD_ENCRYPTION_KEY');
    this.previous = previousKeys.map((k) => ringKey(k, 'FIELD_ENCRYPTION_KEYS_PREVIOUS'));
    this.byId = new Map();
    for (const k of [this.current, ...this.previous]) {
      if (this.byId.has(k.id)) throw new Error('Field encryption keys must all be different');
      this.byId.set(k.id, k);
    }
  }

  /** The current key's id (safe to log and to show in rotation reports). */
  get keyId(): string {
    return this.current.id;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const header = `v2.${this.current.id}`;
    const cipher = createCipheriv('aes-256-gcm', this.current.key, iv);
    cipher.setAAD(Buffer.from(header));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [
      header,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ct.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts[0] === 'v2' && parts.length === 5) {
      const [, id = '', iv = '', tag = '', ct = ''] = parts;
      const k = this.byId.get(id);
      if (!k) throw new Error('Unknown field encryption key id');
      return open(k.key, iv, tag, ct, Buffer.from(`v2.${id}`));
    }
    if (parts[0] === 'v1' && parts.length === 4) {
      const [, iv = '', tag = '', ct = ''] = parts;
      for (const k of [this.current, ...this.previous]) {
        try {
          return open(k.key, iv, tag, ct, null);
        } catch {
          /* not this key: GCM authentication failed */
        }
      }
      throw new Error('No configured key decrypts this value');
    }
    throw new Error('Unsupported ciphertext');
  }

  /** True when a stored value was not written with the current key (re-encrypt it). */
  needsRotation(payload: string): boolean {
    const parts = payload.split('.');
    return !(parts[0] === 'v2' && parts[1] === this.current.id);
  }

  /** The current key's blind index: store this. */
  blindIndex(value: string): string {
    return hmacIndex(this.current.indexKey, value);
  }

  /** Every configured key's blind index: match against these (`{ $in: ... }`) when looking up. */
  blindIndexes(value: string): string[] {
    return [this.current, ...this.previous].map((k) => hmacIndex(k.indexKey, value));
  }
}

function open(key: Buffer, iv: string, tag: string, ct: string, aad: Buffer | null): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

const hmacIndex = (indexKey: Buffer, value: string) =>
  createHmac('sha256', indexKey).update(value.trim().toLowerCase()).digest('base64url');
