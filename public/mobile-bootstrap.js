// Mobile-mode bootstrap: sets html[data-ui] before first paint. Loaded as a
// blocking same-origin script from index.html, because the page's CSP
// (BROWSER_CSP in build/vite.js) forbids inline script. The query must equal
// MOBILE_QUERY in src/ui/mobileMode.js (mobileMode.test.mjs).
(function () {
  var MOBILE_QUERY = '(pointer: coarse), (hover: none), (max-width: 640px)';
  var root = document.documentElement;
  var mode = null;
  try {
    var u = new URLSearchParams(location.search).get('ui');
    if (u === 'mobile' || u === 'desktop') mode = u;
  } catch (e) {}
  if (!mode) {
    try {
      var s = localStorage.getItem('godsEyeView.ui');
      if (s === 'mobile' || s === 'desktop') mode = s;
    } catch (e) {}
  }
  if (!mode) {
    try {
      mode = matchMedia(MOBILE_QUERY).matches ? 'mobile' : 'desktop';
    } catch (e) {
      mode = 'desktop';
    }
  }
  root.dataset.ui = mode;
})();
