/**
 * Offline and low-data mode (build B13). Zod-free so the web's first load can import it.
 */

/** Image widths the API serves for data saver (`GET /files/:id?w=`); anything else is refused. */
export const DATA_SAVER_WIDTHS = [160, 320, 640] as const;
export type DataSaverWidth = (typeof DATA_SAVER_WIDTHS)[number];

/** Data saver: on, off, or on by itself when the browser reports Save-Data or a 2G connection. */
export const DATA_SAVER_MODES = ['auto', 'on', 'off'] as const;
export type DataSaverMode = (typeof DATA_SAVER_MODES)[number];

/** A saved offline copy older than this is dropped instead of shown. */
export const OFFLINE_MAX_AGE_DAYS = 7;
/** Messages kept per conversation in the offline copy (the newest ones). */
export const OFFLINE_MESSAGES_PER_CONVERSATION = 50;
