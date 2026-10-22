import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
export const email = z.string().trim().toLowerCase().max(254).email();
export const personName = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[^<>{}$]*$/, 'Contains unsupported characters');
export const tenantSlug = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/, 'Lowercase letters, digits and hyphens');
/** Length bounds only; strength (zxcvbn) and breach checks run on the server. */
export const password = z.string().min(10, 'At least 10 characters').max(128, 'At most 128 characters');
export const totpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
export const recoveryCode = z
  .string()
  .regex(/^[a-z0-9]{5}-[a-z0-9]{5}$/i, 'Recovery codes look like abcde-12345');

/** Cursor pagination query (`?cursor=&limit=`). */
export const cursorPageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CursorPageQuery = z.infer<typeof cursorPageQuery>;
