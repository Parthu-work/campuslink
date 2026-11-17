/**
 * localStorage for per-device conveniences only (theme, language, and `member`: whether this device
 * was signed in last time, which only decides what index.html paints first). Never for auth or data.
 */
export const prefs = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`cl:${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`cl:${key}`, value);
    } catch {
      /* private mode or blocked storage */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(`cl:${key}`);
    } catch {
      /* private mode or blocked storage */
    }
  },
};
