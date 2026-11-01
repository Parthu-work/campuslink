import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { OFFLINE_MESSAGES_PER_CONVERSATION, type DataSaverMode } from '@campuslink/shared';

/**
 * The rules of the offline copy and data saver (build B13), kept free of browser state so they are
 * unit-tested (offline-rules.test.ts). lib/offline-cache.ts and lib/data-saver.ts apply them.
 */

/** The reads kept on the device. The member's own data only; never another member's profile. */
export function persistable(key: QueryKey): boolean {
  const [a, b] = key as readonly unknown[];
  switch (a) {
    case 'tenant':
    case 'me':
    case 'conversations':
    case 'job-tracker':
      return key.length === 1;
    case 'bookings':
      return key.length === 2 && (b === 'upcoming' || b === 'past');
    case 'roadmaps':
      return key.length === 2 && b === 'following';
    case 'placement-drives':
      return key.length === 2 && b === 'registered';
    case 'feed':
      return key.length === 2 && b === 'for_you';
    case 'messages':
    case 'conversation':
    case 'roadmap':
    case 'material':
    case 'placement-drive':
      return key.length === 2 && typeof b === 'string';
    default:
      return false;
  }
}

const CONTACT_FIELDS = new Set(['email', 'phone', 'phoneE164', 'mobile', 'whatsapp', 'contact']);

/** Removes contact fields at any depth (everything but the member's own profile goes through it). */
export function stripContacts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripContacts);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!CONTACT_FIELDS.has(k)) out[k] = stripContacts(v);
    return out;
  }
  return value;
}

type Paged = InfiniteData<{ data?: unknown[] } & Record<string, unknown>, unknown>;
const isPaged = (d: unknown): d is Paged =>
  !!d && typeof d === 'object' && Array.isArray((d as Paged).pages) && Array.isArray((d as Paged).pageParams);

/** What is written for a read: the feed's first page, a conversation's newest 50 messages. */
export function toSaved(key: QueryKey, data: unknown): unknown {
  const [a] = key as readonly unknown[];
  let out = data;
  if (a === 'feed' && isPaged(data)) {
    out = { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) };
  } else if (a === 'messages' && isPaged(data)) {
    // Pages run newest first; each page lists its messages oldest first.
    let room = OFFLINE_MESSAGES_PER_CONVERSATION;
    const pages: Paged['pages'] = [];
    for (const p of data.pages) {
      if (room <= 0) break;
      const msgs = Array.isArray(p.data) ? p.data : [];
      const kept = msgs.length > room ? msgs.slice(-room) : msgs;
      room -= kept.length;
      // A trimmed page has no older page to load offline.
      pages.push(kept.length < msgs.length ? { ...p, data: kept, meta: { nextCursor: null } } : p);
    }
    out = { pages, pageParams: data.pageParams.slice(0, pages.length) };
  }
  return a === 'me' ? out : stripContacts(out);
}

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

/** The browser asks for less data: Save-Data is on, or the connection is 2G. */
export function browserWantsLessData(nav: Navigator | undefined = globalThis.navigator): boolean {
  const c = (nav as (Navigator & { connection?: NetworkInformation }) | undefined)?.connection;
  return !!c && (c.saveData === true || c.effectiveType === '2g' || c.effectiveType === 'slow-2g');
}

/** Whether data saver is in effect for a mode (`auto` follows the browser). */
export const dataSaverOn = (mode: DataSaverMode, lessData = browserWantsLessData()) =>
  mode === 'on' || (mode === 'auto' && lessData);
