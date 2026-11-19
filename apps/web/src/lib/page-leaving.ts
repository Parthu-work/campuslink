/**
 * Set while the page is being unloaded (lib/undoable.ts sets it on `pagehide`), so a request sent
 * then goes out with `keepalive` and outlives the page (lib/api.ts). Its own module, so the API
 * client does not bring the toast and Undo code into the app's first load.
 */
let leaving = false;
export const isLeaving = () => leaving;
export const setLeaving = (on: boolean) => {
  leaving = on;
};
