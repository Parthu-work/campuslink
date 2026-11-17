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
    if (lang === 'te' || lang === 'hi' || lang === 'en') root.lang = lang;
    // The landing's first paint (prompt 3, U4): index.html draws the landing's English headline
    // before any script runs, where the landing is what will show: the address is "/", the language
    // is English, the app is not the installed one, and this device was not signed in last time
    // (cl:member, kept by lib/session.ts). The app takes it over or removes it (lib/first-paint.ts).
    var installed = window.matchMedia && matchMedia('(display-mode: standalone)').matches;
    if (
      location.pathname === '/' &&
      lang !== 'te' &&
      lang !== 'hi' &&
      !installed &&
      !localStorage.getItem('cl:member')
    )
      root.dataset.fp = '';
  } catch {
    // Storage blocked: the device theme applies and the launch mark shows.
  }

  // The app's files (prompt 3, U4): the build moves its scripts and the UI font onto this script's
  // tag (vite.config.ts, bootLoadsApp). They start at once, except under the landing's first paint,
  // where they wait for that paint: on a slow connection the stylesheet, and so the headline, would
  // otherwise share it with them. In development index.html loads the app itself and this does nothing.
  var me = document.currentScript;
  var entry = me && me.getAttribute('data-entry');
  if (!entry) return;
  var started = false;
  var start = function () {
    if (started) return;
    started = true;
    var font = me.getAttribute('data-font');
    if (font) {
      var face = document.createElement('link');
      face.rel = 'preload';
      face.as = 'font';
      face.type = 'font/woff2';
      face.crossOrigin = '';
      face.href = font;
      document.head.appendChild(face);
    }
    var files = [entry].concat((me.getAttribute('data-preload') || '').split(' ').filter(Boolean));
    for (var i = 0; i < files.length; i++) {
      var link = document.createElement('link');
      link.rel = 'modulepreload';
      link.crossOrigin = '';
      link.href = files[i];
      document.head.appendChild(link);
    }
    // A module added by script runs as soon as it arrives: wait for #root to be parsed.
    var run = function () {
      var script = document.createElement('script');
      script.type = 'module';
      script.crossOrigin = '';
      script.src = entry;
      document.body.appendChild(script);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  };
  if ('fp' in root.dataset) {
    // Just after the first paint (a hidden tab paints nothing: start anyway after a moment).
    requestAnimationFrame(function () {
      setTimeout(start, 0);
    });
    setTimeout(start, 1500);
  } else start();
})();
