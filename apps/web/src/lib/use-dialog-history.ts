import { useEffect, useId, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { isNavigating } from './router-state';

interface DialogState {
  dialog?: string;
}

/**
 * Makes an open dialog or sheet a history entry (audit PW-2, B17): opening pushes an entry for the
 * same screen, the browser's Back (and the Android back gesture) closes it, and closing it from
 * the UI pops that entry again. Overlays whose open state is already in the URL
 * (lib/use-url-overlay.ts) pass `enabled: false`.
 */
export function useDialogHistory(open: boolean, onOpenChange: (open: boolean) => void, enabled = true) {
  const id = useId();
  const location = useLocation();
  const navigate = useNavigate();
  const pushed = useRef(false);
  const close = useRef(onOpenChange);
  useEffect(() => {
    close.current = onOpenChange;
  });

  // Opened: push an entry for this screen that carries the dialog's id.
  useEffect(() => {
    if (!enabled || !open || pushed.current) return;
    pushed.current = true;
    void navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { state: { ...(location.state as object | null), dialog: id } },
    );
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, open]);

  // Back left the dialog's entry (after we were on it): close it.
  const onEntry = useRef(false);
  useEffect(() => {
    if (!pushed.current) return;
    const here = (location.state as DialogState | null)?.dialog === id;
    if (here) onEntry.current = true;
    else if (onEntry.current) {
      onEntry.current = false;
      pushed.current = false;
      close.current(false);
    }
  }, [location, id]);

  // Closed by the member (Escape, the close button, the scrim): pop the entry we pushed. A close
  // made by code (a form that saved, a sign-out) leaves history alone, because whatever comes next
  // (staying, or navigating elsewhere) must win; the only cost is one extra entry for this screen.
  const byMember = useRef(false);
  useEffect(() => {
    if (open || !pushed.current) return;
    pushed.current = false;
    onEntry.current = false;
    if (!byMember.current) return;
    byMember.current = false;
    const state = (window.history.state as { usr?: DialogState } | null)?.usr;
    if (state?.dialog === id && !isNavigating()) void navigate(-1);
  }, [open, id, navigate]);

  // Dialogs that unmount as they close (the story viewer, `{open && <Dialog open />}`) pop here.
  useEffect(
    () => () => {
      if (!pushed.current || !byMember.current) return;
      const state = (window.history.state as { usr?: DialogState } | null)?.usr;
      if (state?.dialog === id && !isNavigating()) window.history.back();
    },
    [id],
  );

  /** Pass this to the dialog as its close handler, so member-initiated closes are recognised. */
  return (next: boolean) => {
    if (!next) byMember.current = true;
    onOpenChange(next);
  };
}
