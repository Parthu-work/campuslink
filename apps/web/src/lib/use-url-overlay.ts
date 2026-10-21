import { useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

interface OverlayState {
  overlay?: string;
}

/**
 * An overlay (sheet, dialog, step panel) whose open state lives in the URL, so the browser back
 * button and the Android back gesture close it instead of leaving the screen, and it can be linked.
 * Opening pushes a history entry; closing pops it when we pushed it, otherwise it replaces the URL.
 */
export function useUrlOverlay(key: string) {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const value = params.get(key);

  const open = useCallback(
    (next: string) => {
      const p = new URLSearchParams(location.search);
      if (p.get(key) === next) return;
      const pushed = (location.state as OverlayState | null)?.overlay === key;
      p.set(key, next);
      // Switching from one value to another (step 2 → step 3) replaces, so Back still closes it.
      navigate(
        { pathname: location.pathname, search: `?${p}`, hash: location.hash },
        { replace: pushed, state: { ...(location.state as object | null), overlay: key } },
      );
    },
    [key, location, navigate],
  );

  const close = useCallback(() => {
    const p = new URLSearchParams(location.search);
    if (!p.has(key)) return;
    if ((location.state as OverlayState | null)?.overlay === key) {
      void navigate(-1);
      return;
    }
    p.delete(key);
    const search = p.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash },
      { replace: true },
    );
  }, [key, location, navigate]);

  /** Links inside an overlay replace its history entry, so Back from the destination skips it. */
  const replaceOnLeave = (location.state as OverlayState | null)?.overlay === key && value !== null;

  return { value, open, close, replaceOnLeave };
}
