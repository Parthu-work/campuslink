/** localStorage for per-device conveniences only (theme, language). Never for auth or data. */
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
};
