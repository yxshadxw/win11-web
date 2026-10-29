// Applies the saved theme to any app page, and follows changes made in Settings.
const KEY = 'win11web.theme';

function read() {
  try { return localStorage.getItem(KEY) || 'light'; } catch { return 'light'; }
}

function apply(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

apply(read());
window.addEventListener('storage', (e) => { if (e.key === KEY) apply(read()); });
