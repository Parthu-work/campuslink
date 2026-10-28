import { useEffect, useState } from 'react';

/**
 * Unsent writing (the post composer, comment and reply boxes), kept in this tab's memory: closing
 * a sheet or moving to another screen keeps it (audit FO-5); a reload, closing the tab or signing
 * out drops it. Never written to the device, so nothing private stays behind on a shared phone.
 */
const drafts = new Map<string, string>();

export function useDraft(key: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => drafts.get(key) ?? '');
  useEffect(() => {
    if (value.trim()) drafts.set(key, value);
    else drafts.delete(key);
  }, [key, value]);
  return [value, setValue];
}

export const clearDrafts = () => drafts.clear();
