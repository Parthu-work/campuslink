import { z } from 'zod';
import {
  CLIENT_ERROR_KINDS,
  SUPPORT_CATEGORIES,
  SUPPORT_LIMITS,
  SUPPORT_STATUSES,
  type SupportCategory,
  type SupportDesk,
  type SupportStatus,
} from '../constants/support.js';
import { objectId } from './common.js';

/** Help and support (build B14). Plain text only (stored with `plainText`). */
export const supportTicketBody = z.strictObject({
  category: z.enum(SUPPORT_CATEGORIES),
  subject: z.string().trim().min(4).max(SUPPORT_LIMITS.subject),
  body: z.string().trim().min(10).max(SUPPORT_LIMITS.body),
  /** An image uploaded first through POST /support/screenshots (single use). */
  screenshotFileId: objectId.optional(),
});
export const supportReplyBody = z.strictObject({
  body: z.string().trim().min(1).max(SUPPORT_LIMITS.body),
});
export const supportStatusBody = z.strictObject({ status: z.enum(['closed', 'open']) });
export const supportQueueQuery = z.strictObject({ status: z.enum(SUPPORT_STATUSES).optional() });

export interface SupportReplyView {
  id: string;
  /** Who wrote it: the member who reported, the college, or the platform. */
  from: 'member' | SupportDesk;
  /** The writer's name (the member's own name, or the staff member's). */
  name: string;
  body: string;
  at: string;
}
export interface SupportTicketView {
  id: string;
  category: SupportCategory;
  desk: SupportDesk;
  subject: string;
  body: string;
  status: SupportStatus;
  hasScreenshot: boolean;
  /** Readable through GET /files/:id by the reporter and the college's desk. */
  screenshotFileId: string | null;
  /** The reporter (shown to the desk; null once they erased their account). */
  reporter: { id: string; name: string } | null;
  replies: SupportReplyView[];
  createdAt: string;
  updatedAt: string;
  /** Platform queue only: the college it came from. */
  college?: { id: string; slug: string; name: string };
}

/** POST /client-errors: what a browser may report. No personal data; the route path has ids masked. */
export const clientErrorBody = z.strictObject({
  kind: z.enum(CLIENT_ERROR_KINDS),
  message: z.string().max(300),
  route: z.string().max(200),
  release: z
    .string()
    .regex(/^[\w.-]{1,40}$/)
    .optional(),
  /** A one-way hash of the member's id, made in the browser (never the id itself). */
  userHash: z
    .string()
    .regex(/^[a-f0-9]{16,64}$/)
    .optional(),
});
export type ClientErrorBody = z.infer<typeof clientErrorBody>;
