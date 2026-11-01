import { usePreferences } from './preferences';
import { dataSaverOn } from './offline-rules';

/**
 * Data saver (build B13), set in Settings › Preferences: smaller images (the API's `?w=` variants),
 * no stories and no video preloading. On by itself when the browser reports Save-Data or 2G.
 */
export function useDataSaver(): boolean {
  return dataSaverOn(usePreferences((s) => s.dataSaver));
}
