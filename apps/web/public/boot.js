// Applies the member's saved theme, motion and language before the first paint, so light-mode members
// never see a dark flash (audit PW-1). Loaded synchronously from index.html; 'self' under the CSP.
(function () {
  try {
    var root = document.documentElement;
    var theme = localStorage.getItem('cl:theme');
    if (theme === 'dark' || theme === 'light') root.dataset.theme = theme;
    var motion = localStorage.getItem('cl:motion');
    if (motion === 'full' || motion === 'reduce') root.dataset.motion = motion;
    var lang = localStorage.getItem('cl:lang');
    if (lang === 'te' || lang === 'en') root.lang = lang;
  } catch {
    // Storage blocked: the device theme applies.
  }
})();
