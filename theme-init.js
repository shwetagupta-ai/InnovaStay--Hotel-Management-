/* Runs before the page paints, so the chosen light/dark mode is applied without a flash. */
(function () {
  var mode = null;
  try { mode = localStorage.getItem('innovastay-theme'); } catch (e) { /* storage blocked */ }
  if (mode !== 'dark' && mode !== 'light') mode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', mode);
})();
