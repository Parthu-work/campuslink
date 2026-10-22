// Applies the member's saved theme, motion and language before the first paint, so light-mode members
// never see a dark flash (audit PW-1). Loaded synchronously from index.html; 'self' under the CSP.
(function () {
  var root = document.documentElement;
  // Low-end devices get solid bars instead of a live backdrop blur (the glass utility, index.css).
  var cores = navigator.hardwareConcurrency;
  var memory = navigator.deviceMemory;
  if ((cores && cores <= 4) || (memory && memory <= 2)) root.dataset.lowend = '';
  try {
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
