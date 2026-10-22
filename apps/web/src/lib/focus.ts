/**
 * Callback ref for content that replaces the control the member just used (a confirmation replacing
 * a form): focus moves to it, so keyboard and screen-reader users keep their place (audit A11Y-6).
 */
export const focusOnMount = (el: HTMLElement | null) => {
  if (el && !el.contains(document.activeElement)) el.focus();
};
