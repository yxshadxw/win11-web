// In-site browser. External pages load through the server proxy (/proxy?url=) inside a
// sandboxed iframe with an opaque origin; this site's own pages load directly.
const SEARCH = 'https://html.duckduckgo.com/html/?q=';
const NEWTAB = 'chrome://newtab';
const SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox';
const SHORTCUTS = [
  { name: '위키백과', icon: '📚', url: 'https://ko.wikipedia.org/' },
  { name: 'DuckDuckGo', icon: '🦆', url: 'https://html.duckduckgo.com/html/' },
  { name: 'Hacker News', icon: '🗞️', url: 'https://news.ycombinator.com/' },
  { name: 'MDN', icon: '📘', url: 'https://developer.mozilla.org/ko/' },
  { name: 'example.com', icon: '🌐', url: 'https://example.com/' },
  { name: '웹 카트', icon: '🏎️', url: '/apps/webkart/' },
  { name: '메모장', icon: '📝', url: '/apps/notepad/' },
  { name: '고스톱', icon: '🎴', url: '/apps/gostop/' },
];

const $ = (s) => document.querySelector(s);
const tabsEl = $('#tabs');
const viewsEl = $('#views');
const address = $('#address');

const tabs = [];
let active = null;
let seq = 0;

function isInternal(url) {
  return url.startsWith('/') || url.startsWith(location.origin + '/');
}

/** Turns omnibox text into a URL: a path, a URL, a bare domain, or a search. */
function resolveInput(text) {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('/')) return t;
  if (/^https?:\/\//i.test(t)) return t;
  if (!/\s/.test(t) && /^[^\s/]+\.[a-z]{2,}(?::\d+)?(\/.*)?$/i.test(t)) return `https://${t}`;
  return SEARCH + encodeURIComponent(t);
}

function displayUrl(url) {
  if (url === NEWTAB) return '';
  if (url.startsWith('/')) return location.origin + url;
  return url;
}

function makeTab() {
  const tab = { id: ++seq, history: [], index: -1, title: '새 탭', loading: false, view: null };
  tabs.push(tab);
  return tab;
}

function currentUrl(tab) {
  return tab.history[tab.index] ?? NEWTAB;
}

function render() {
  tabsEl.replaceChildren(...tabs.map((tab) => {
    const li = document.createElement('li');
    li.className = 'tab';
    li.setAttribute('role', 'tab');
    li.setAttribute('aria-selected', String(tab === active));
    li.dataset.id = String(tab.id);
    li.title = tab.title;
    const fav = document.createElement('span');
    fav.className = 'fav';
    fav.textContent = tab.loading ? '⏳' : currentUrl(tab) === NEWTAB ? '⭐' : isInternal(currentUrl(tab)) ? '🪟' : '🌐';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = tab.title;
    const x = document.createElement('button');
    x.className = 'x';
    x.type = 'button';
    x.setAttribute('aria-label', '탭 닫기');
    x.textContent = '×';
    li.append(fav, name, x);
    return li;
  }));

  for (const tab of tabs) if (tab.view) tab.view.hidden = tab !== active;
  if (!active) return;
  const url = currentUrl(active);
  if (document.activeElement !== address) address.value = displayUrl(url);
  $('#lock').textContent = url === NEWTAB ? '🔍' : url.startsWith('http://') ? '⚠️' : '🔒';
  $('#back').disabled = active.index <= 0;
  $('#forward').disabled = active.index >= active.history.length - 1;
  $('#progress').hidden = !active.loading;
  document.title = `${active.title} - 크롬`;
}

function buildNewTab(tab) {
  const node = $('#newtab-tpl').content.firstElementChild.cloneNode(true);
  node.classList.add('view');
  node.querySelector('.shortcuts').replaceChildren(...SHORTCUTS.map((s) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shortcut';
    const ico = document.createElement('span');
    ico.className = 'ico';
    ico.textContent = s.icon;
    btn.append(ico, s.name);
    btn.addEventListener('click', () => navigate(tab, s.url));
    li.append(btn);
    return li;
  }));
  const form = node.querySelector('.newtab-search');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = resolveInput(form.q.value);
    if (url) navigate(tab, url);
  });
  return node;
}

/** Shows the tab's current history entry, swapping the view element when its kind changes. */
function show(tab) {
  const url = currentUrl(tab);
  const kind = url === NEWTAB ? 'newtab' : isInternal(url) ? 'internal' : 'external';
  let view = tab.view;
  if (!view || view.dataset.kind !== kind) {
    if (kind === 'newtab') {
      view = buildNewTab(tab);
    } else {
      view = document.createElement('iframe');
      view.className = 'view';
      view.allow = 'fullscreen; autoplay';
      if (kind === 'external') view.setAttribute('sandbox', SANDBOX);
      view.addEventListener('load', () => onFrameLoad(tab));
    }
    view.dataset.kind = kind;
    tab.view?.remove();
    tab.view = view;
    viewsEl.append(view);
  }

  if (kind === 'newtab') {
    tab.title = '새 탭';
    tab.loading = false;
  } else {
    tab.loading = true;
    tab.title = url.replace(/^https?:\/\//, '');
    view.src = kind === 'external' ? `/proxy?url=${encodeURIComponent(url)}` : url;
  }
  render();
}

function onFrameLoad(tab) {
  if (tab.view?.dataset.kind === 'internal') {
    // Same-origin page: read its real location (links inside it don't message us).
    try {
      const loc = tab.view.contentWindow.location;
      const url = loc.pathname + loc.search;
      if (url !== currentUrl(tab)) recordUrl(tab, url);
      tab.title = tab.view.contentDocument.title || url;
    } catch { /* ignore */ }
  }
  tab.loading = false;
  render();
}

/** A URL reported while our own navigation is still loading is a redirect: replace, don't push. */
function recordUrl(tab, url) {
  if (tab.loading && tab.index >= 0) tab.history[tab.index] = url;
  else pushEntry(tab, url);
}

function pushEntry(tab, url) {
  tab.history = tab.history.slice(0, tab.index + 1);
  tab.history.push(url);
  tab.index = tab.history.length - 1;
}

function navigate(tab, url) {
  pushEntry(tab, url);
  show(tab);
}

function activate(tab) {
  active = tab;
  render();
}

function openTab(url = NEWTAB) {
  const tab = makeTab();
  active = tab;
  if (url === NEWTAB) {
    show(tab);
    address.focus();
  } else {
    navigate(tab, url);
  }
}

function closeTab(tab) {
  const i = tabs.indexOf(tab);
  tabs.splice(i, 1);
  tab.view?.remove();
  if (!tabs.length) return openTab();
  if (active === tab) active = tabs[Math.min(i, tabs.length - 1)];
  render();
}

// Proxied pages report their real URL/title as they navigate by links.
window.addEventListener('message', (e) => {
  if (e.data?.type !== 'win11web-proxy-nav' || typeof e.data.url !== 'string') return;
  const tab = tabs.find((t) => t.view?.contentWindow === e.source);
  if (!tab) return;
  if (e.data.url !== currentUrl(tab)) recordUrl(tab, e.data.url);
  if (e.data.title) tab.title = String(e.data.title).slice(0, 200);
  render();
});

tabsEl.addEventListener('click', (e) => {
  const li = e.target.closest('.tab');
  if (!li) return;
  const tab = tabs.find((t) => t.id === Number(li.dataset.id));
  if (e.target.closest('.x')) closeTab(tab);
  else activate(tab);
});
tabsEl.addEventListener('auxclick', (e) => {
  const li = e.target.closest('.tab');
  if (e.button === 1 && li) closeTab(tabs.find((t) => t.id === Number(li.dataset.id)));
});

$('#new-tab').addEventListener('click', () => openTab());
$('#omnibox').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = resolveInput(address.value);
  if (!url) return;
  address.blur();
  navigate(active, url);
});
address.addEventListener('focus', () => address.select());
$('#back').addEventListener('click', () => { if (active.index > 0) { active.index--; show(active); } });
$('#forward').addEventListener('click', () => {
  if (active.index < active.history.length - 1) { active.index++; show(active); }
});
$('#reload').addEventListener('click', () => show(active));
$('#home').addEventListener('click', () => navigate(active, NEWTAB));
$('#external').addEventListener('click', () => {
  const url = currentUrl(active);
  if (url !== NEWTAB) window.open(displayUrl(url), '_blank', 'noopener');
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 't') { e.preventDefault(); openTab(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'w') { e.preventDefault(); closeTab(active); }
  if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); address.focus(); }
  if (e.key === 'F5') { e.preventDefault(); show(active); }
});

const start = new URLSearchParams(location.search).get('url');
openTab(start ? resolveInput(start) : NEWTAB);
