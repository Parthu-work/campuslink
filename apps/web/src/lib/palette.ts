import { useEffect } from 'react';
import { create } from 'zustand';

export const usePalette = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** Ctrl/Cmd+K toggles the palette anywhere in the signed-in app. */
export function usePaletteShortcut() {
  const setOpen = usePalette((s) => s.setOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!usePalette.getState().open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
}
