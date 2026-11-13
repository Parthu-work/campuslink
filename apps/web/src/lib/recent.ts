/**
 * What the member last opened from search (prompt 3, U2), offered again when the palette opens
 * with nothing typed. Names of people and companies are personal to whoever searched, so this is
 * kept for the browser tab only (sessionStorage, never localStorage) and cleared at sign-out.
 */
export interface RecentItem {
  to: string;
  label: string;
  /** What kind of thing it is, for its icon. */
  kind:
    'person' | 'company' | 'drive' | 'roadmap' | 'subject' | 'event' | 'job' | 'post' | 'question' | 'page';
}

const KEY = 'cl:recent';
const LIMIT = 6;

export function recentItems(): RecentItem[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (x): x is RecentItem =>
          !!x &&
          typeof (x as RecentItem).to === 'string' &&
          (x as RecentItem).to.startsWith('/') &&
          typeof (x as RecentItem).label === 'string' &&
          typeof (x as RecentItem).kind === 'string',
      )
      .slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function rememberRecent(item: RecentItem): void {
  try {
    const next = [
      { ...item, label: item.label.slice(0, 80) },
      ...recentItems().filter((x) => x.to !== item.to),
    ].slice(0, LIMIT);
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode or blocked storage: no recents */
  }
}

export function clearRecent(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
