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
 * numbers and TOTP secrets. Format: v1.<iv>.<tag>.<ciphertext> (base64url). A deterministic HMAC
 * (`blindIndex`) allows equality lookups without decrypting.
 */
export class FieldCipher {
  private readonly key: Buffer;
  private readonly indexKey: Buffer;
  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes');
    this.key = key;
    this.indexKey = createHmac('sha256', key).update('blind-index-v1').digest();
  }
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), ct]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }
  decrypt(payload: string): string {
    const [v, iv, tag, ct] = payload.split('.');
    if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }
  blindIndex(value: string): string {
    return createHmac('sha256', this.indexKey).update(value.trim().toLowerCase()).digest('base64url');
  }
}
