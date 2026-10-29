import { WindowManager } from './window-manager.js';
import { DesktopIcons } from './icons.js';
import { Panels } from './panels.js';
import { boot, lock } from './boot.js';
import { Widgets } from './widgets.js';
import { $, appIcon, store } from './util.js';

const THEME_KEY = 'win11web.theme';
const WALLPAPER_KEY = 'win11web.wallpaper';
const PINNED_KEY = 'win11web.pinned';
const RECENT_KEY = 'win11web.recent';
const WALLPAPERS = ['bloom', 'glow', 'sunrise', 'night'];
const DEFAULT_PINNED = ['explorer', 'chrome', 'terminal', 'webkart', 'gostop'];

const wm = new WindowManager($('#windows'), $('#snap-preview'));
let apps = [];
let pinned = store.getJSON(PINNED_KEY, DEFAULT_PINNED);
let widgets = null;
let showAllApps = false;

const appById = (id) => apps.find((a) => a.id === id);

/** Opens an app window; `url` may point the window at a deeper page of that same app (e.g. ?file=). */
function openApp(id, url) {
  const app = appById(id);
  if (!app) return;
  closeFlyouts();
  const deep = typeof url === 'string' && url.startsWith(app.url) ? url : app.url;
  wm.open({ ...app, url: deep });
  const recent = [id, ...store.getJSON(RECENT_KEY, []).filter((r) => r !== id)].slice(0, 6);
  store.setJSON(RECENT_KEY, recent);
}

/* ---------- wallpaper & theme ---------- */
function applyWallpaper() {
  const wp = store.get(WALLPAPER_KEY, 'bloom');
  for (const name of WALLPAPERS) document.body.classList.toggle(`wp-${name}`, name === wp);
}

function cycleWallpaper() {
  const cur = store.get(WALLPAPER_KEY, 'bloom');
  store.set(WALLPAPER_KEY, WALLPAPERS[(WALLPAPERS.indexOf(cur) + 1) % WALLPAPERS.length]);
  applyWallpaper();
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  store.set(THEME_KEY, next);
  document.documentElement.dataset.theme = next;
  // Same-origin app windows don't get a storage event for writes made by this document.
  for (const frame of document.querySelectorAll('.window iframe')) {
    try { frame.contentDocument.documentElement.dataset.theme = next; } catch { /* cross-origin */ }
  }
}

window.addEventListener('storage', (e) => {
  if (e.key === WALLPAPER_KEY) applyWallpaper();
});

const panels = new Panels({ toggleTheme, cycleWallpaper, openApp });
const icons = new DesktopIcons($('#icons'), { onOpen: openApp });

/* ---------- taskbar ---------- */
function savePinned() {
  store.setJSON(PINNED_KEY, pinned);
  renderTaskbar();
}

function renderTaskbar() {
  const openIds = [...new Set([...wm.windows.values()].map((w) => w.app.id))];
  const ids = [...pinned, ...openIds.filter((id) => !pinned.includes(id))].filter(appById);

  $('#taskbar-apps').replaceChildren(...ids.map((id) => {
    const app = appById(id);
    const wins = wm.findByApp(id);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tb-btn';
    btn.dataset.id = id;
    btn.title = wins.length > 1 ? `${app.name} - 창 ${wins.length}개` : app.name;
    btn.setAttribute('aria-label', app.name);
    btn.append(appIcon(app, 24));
    if (wins.length) {
      const ind = document.createElement('span');
      ind.className = 'ind';
      btn.append(ind);
      if (wins.some((w) => w.id === wm.activeId && !w.minimized)) btn.classList.add('active');
    }
    li.append(btn);
    return li;
  }));
}

$('#taskbar-apps').addEventListener('click', (e) => {
  const id = e.target.closest('.tb-btn')?.dataset.id;
  if (!id) return;
  closeFlyouts();
  const wins = wm.findByApp(id);
  if (!wins.length) return openApp(id);
  // Cycle through this app's windows, or minimize when the active one is clicked again.
  const activeIdx = wins.findIndex((w) => w.id === wm.activeId && !w.minimized);
  if (activeIdx === -1) wm.focus(wins[wins.length - 1].id);
  else if (wins.length === 1) wm.toggleFromTaskbar(wins[0].id);
  else wm.focus(wins[(activeIdx + 1) % wins.length].id);
});

$('#taskbar-apps').addEventListener('contextmenu', (e) => {
  const id = e.target.closest('.tb-btn')?.dataset.id;
  if (!id) return;
  e.preventDefault();
  const app = appById(id);
  const isPinned = pinned.includes(id);
  const items = [
    { label: `${app.name} 새 창`, run: () => openApp(id) },
    { label: '새 탭에서 열기', run: () => window.open(app.url, '_blank', 'noopener') },
    isPinned
      ? { label: '작업 표시줄에서 제거', run: () => { pinned = pinned.filter((p) => p !== id); savePinned(); } }
      : { label: '작업 표시줄에 고정', run: () => { pinned = [...pinned, id]; savePinned(); } },
  ];
  if (wm.findByApp(id).length) items.push(null, { label: '모든 창 닫기', run: () => wm.closeApp(id) });
  const r = e.target.closest('.tb-btn').getBoundingClientRect();
  showMenu(items, r.left, r.top, { above: true });
});

wm.addEventListener('change', renderTaskbar);

function tickClock() {
  const now = new Date();
  const time = now.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  const date = now.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\.$/, '');
  $('#clock').textContent = `${time}\n${date}`;
  $('#clock').dateTime = now.toISOString();
}

/* ---------- start menu ---------- */
const startMenu = $('#start-menu');
const startSearch = $('#start-search');

function startButton(app, className, size) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.dataset.id = app.id;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = app.name;
  btn.append(appIcon(app, size), name);
  if (className === 'start-recent-item') {
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = app.category;
    name.append(sub);
  }
  li.append(btn);
  return li;
}

function renderStartApps(query = '') {
  const q = query.trim().toLowerCase();
  const searching = Boolean(q);
  const pool = searching || showAllApps ? apps : apps.filter((a) => a.desktop);
  const matches = pool.filter((a) => !q || a.name.toLowerCase().includes(q) || a.id.includes(q) || a.category.includes(q));
  $('#start-recent-wrap').hidden = searching || showAllApps;
  $('#start-apps-title').textContent = searching ? '검색 결과' : showAllApps ? '모든 앱' : '고정됨';
  $('#all-apps').setAttribute('aria-pressed', String(showAllApps));
  $('#all-apps').firstChild.textContent = showAllApps ? '뒤로 ' : '모든 앱 ';
  const list = $('#start-apps');
  list.classList.toggle('all', showAllApps && !searching);
  if (showAllApps && !searching) {
    // Grouped by category, with a heading per group.
    const groups = [...new Set(apps.map((a) => a.category))];
    list.replaceChildren(...groups.flatMap((cat) => [
      Object.assign(document.createElement('li'), { className: 'start-group', textContent: cat }),
      ...apps.filter((a) => a.category === cat).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
        .map((app) => startButton(app, 'start-recent-item', 28)),
    ]));
    return;
  }
  if (!matches.length) {
    const li = document.createElement('li');
    li.className = 'start-empty';
    li.textContent = `"${query}"와 일치하는 앱이 없습니다.`;
    list.replaceChildren(li);
  } else {
    list.replaceChildren(...matches.map((app) => startButton(app, 'start-app', 32)));
  }
  const recent = store.getJSON(RECENT_KEY, []).map(appById).filter(Boolean).slice(0, 4);
  const recentList = $('#start-recent');
  if (recent.length) recentList.replaceChildren(...recent.map((app) => startButton(app, 'start-recent-item', 28)));
  else {
    const li = document.createElement('li');
    li.className = 'start-empty';
    li.textContent = '앱을 열면 여기에 표시됩니다.';
    recentList.replaceChildren(li);
  }
}

function openStart() {
  closeFlyouts();
  showAllApps = false;
  startMenu.hidden = false;
  $('#start-btn').setAttribute('aria-expanded', 'true');
  startSearch.value = '';
  renderStartApps();
  startSearch.focus();
}

function closeStart() {
  startMenu.hidden = true;
  $('#power-menu').hidden = true;
  $('#start-btn').setAttribute('aria-expanded', 'false');
}

function closeFlyouts() {
  closeStart();
  panels.closeAll();
  widgets?.close();
  closeTaskView();
  $('#context-menu').hidden = true;
}

$('#start-btn').addEventListener('click', () => (startMenu.hidden ? openStart() : closeStart()));
$('#search-btn').addEventListener('click', () => openStart());
startSearch.addEventListener('input', () => renderStartApps(startSearch.value));
$('#all-apps').addEventListener('click', () => { showAllApps = !showAllApps; renderStartApps(startSearch.value); });
startSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const first = $('#start-apps [data-id]');
    if (first) openApp(first.dataset.id);
  }
});
startMenu.addEventListener('click', (e) => {
  const id = e.target.closest('[data-id]')?.dataset.id;
  if (id) openApp(id);
});
$('#power').addEventListener('click', () => {
  const menu = $('#power-menu');
  menu.hidden = !menu.hidden;
  $('#power').setAttribute('aria-expanded', String(!menu.hidden));
});
$('#power-menu').addEventListener('click', (e) => {
  const act = e.target.closest('[data-power]')?.dataset.power;
  closeFlyouts();
  if (act === 'restart') {
    try { sessionStorage.removeItem('win11web.booted'); } catch { /* ignore */ }
    location.reload();
  } else if (act === 'lock') lock();
});

/* ---------- tray ---------- */
$('#tray-btn').addEventListener('click', () => { closeStart(); panels.toggle($('#quick-settings')); });
$('#clock-btn').addEventListener('click', () => { closeStart(); panels.toggle($('#notify-center')); });

/* ---------- context menus ---------- */
const ctx = $('#context-menu');
let menuItems = [];

function showMenu(items, x, y, { above = false } = {}) {
  menuItems = items;
  ctx.replaceChildren(...items.map((item, i) => {
    const li = document.createElement('li');
    if (!item) { li.append(document.createElement('hr')); return li; }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.dataset.index = String(i);
    btn.textContent = item.label;
    li.append(btn);
    return li;
  }));
  ctx.hidden = false;
  const r = ctx.getBoundingClientRect();
  ctx.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  ctx.style.top = `${above ? y - r.height - 8 : Math.min(y, innerHeight - r.height - 52)}px`;
  ctx.querySelector('button')?.focus();
}

$('#desktop').addEventListener('pointerdown', (e) => {
  if (e.target === $('#icons') || e.target === $('#desktop')) {
    icons.select([]);
    icons.startMarquee(e, $('#marquee'));
  }
});

$('#desktop').addEventListener('contextmenu', (e) => {
  if (e.target.closest('.window')) return;
  e.preventDefault();
  const iconId = e.target.closest('.desk-cell')?.dataset.id;
  if (iconId) {
    const app = appById(iconId);
    showMenu([
      { label: '열기', run: () => openApp(iconId) },
      { label: '새 탭에서 열기', run: () => window.open(app.url, '_blank', 'noopener') },
      { label: '주소 복사', run: () => navigator.clipboard?.writeText(location.origin + app.url)
        .then(() => panels.notify('주소를 복사했습니다', location.origin + app.url)).catch(() => {}) },
    ], e.clientX, e.clientY);
    return;
  }
  showMenu([
    { label: '새로 고침', run: () => location.reload() },
    { label: '아이콘 자동 정렬', run: () => icons.resetPositions() },
    { label: '배경 화면 바꾸기', run: cycleWallpaper },
    { label: '테마 전환', run: toggleTheme },
    null,
    { label: '터미널에서 열기', run: () => openApp('terminal') },
    { label: '개인 설정', run: () => openApp('settings') },
  ], e.clientX, e.clientY);
});
ctx.addEventListener('click', (e) => {
  const idx = e.target.closest('button')?.dataset.index;
  ctx.hidden = true;
  if (idx !== undefined) menuItems[idx].run();
});

/* ---------- global ---------- */
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#context-menu')) ctx.hidden = true;
  if (!e.target.closest('#start-menu, #start-btn, #search-btn')) closeStart();
  if (!e.target.closest('#quick-settings, #notify-center, #tray-btn, #clock-btn')) panels.closeAll();
  if (!e.target.closest('#widgets, #widget-btn')) widgets?.close();
  if (!e.target.closest('#task-view, #taskview-btn')) closeTaskView();
});
window.addEventListener('blur', closeFlyouts);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeFlyouts();
  if (e.key === 'Meta' || (e.ctrlKey && e.key === 'Escape')) {
    e.preventDefault();
    startMenu.hidden ? openStart() : closeStart();
  }
});

// Apps talk to the shell with postMessage: open another app, or post a notification.
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  if (e.data?.type === 'win11web-open' && typeof e.data.id === 'string') openApp(e.data.id, e.data.url);
  if (e.data?.type === 'win11web-notify') panels.notify(e.data.title, e.data.body);
});

/* ---------- task view ---------- */
const taskView = $('#task-view');

function openTaskView() {
  closeFlyouts();
  const wins = [...wm.windows.values()];
  const list = $('#tv-list');
  if (!wins.length) {
    list.replaceChildren(Object.assign(document.createElement('li'), { className: 'tv-empty', textContent: '열린 창이 없습니다.' }));
  } else {
    list.replaceChildren(...wins.map((w) => {
      const li = document.createElement('li');
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'tv-card';
      card.dataset.id = w.id;
      if (w.id === wm.activeId && !w.minimized) card.classList.add('current');
      const head = document.createElement('span');
      head.className = 'tv-head';
      head.append(appIcon(w.app, 16), Object.assign(document.createElement('span'), { className: 'tv-name', textContent: w.el.querySelector('.t-title').textContent }));
      const body = document.createElement('span');
      body.className = 'tv-body';
      body.append(appIcon(w.app, 64));
      if (w.minimized) body.append(Object.assign(document.createElement('span'), { className: 'tv-min', textContent: '최소화됨' }));
      const close = Object.assign(document.createElement('span'), { className: 'tv-close', textContent: '×', title: '닫기' });
      close.setAttribute('role', 'button');
      close.setAttribute('aria-label', '창 닫기');
      card.append(head, body, close);
      li.append(card);
      return li;
    }));
  }
  taskView.hidden = false;
  $('#taskview-btn').setAttribute('aria-expanded', 'true');
  $('#tv-list button')?.focus();
}

function closeTaskView() {
  taskView.hidden = true;
  $('#taskview-btn').setAttribute('aria-expanded', 'false');
}

$('#taskview-btn').addEventListener('click', () => (taskView.hidden ? openTaskView() : closeTaskView()));
taskView.addEventListener('click', (e) => {
  const card = e.target.closest('.tv-card');
  if (!card) { closeTaskView(); return; }
  if (e.target.closest('.tv-close')) {
    wm.close(card.dataset.id);
    card.parentElement.remove();
    if (!wm.windows.size) closeTaskView();
    return;
  }
  closeTaskView();
  wm.focus(card.dataset.id);
});

/* ---------- taskbar hover previews ---------- */
const preview = $('#tb-preview');
let previewTimer = null;

$('#taskbar-apps').addEventListener('pointerover', (e) => {
  const btn = e.target.closest('.tb-btn');
  if (!btn || e.pointerType !== 'mouse') return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const app = appById(btn.dataset.id);
    const wins = wm.findByApp(btn.dataset.id);
    preview.replaceChildren(Object.assign(document.createElement('div'), { className: 'pv-app', textContent: app.name }));
    for (const w of wins) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pv-win';
      row.dataset.id = w.id;
      row.append(appIcon(app, 16), Object.assign(document.createElement('span'), { textContent: w.el.querySelector('.t-title').textContent }));
      preview.append(row);
    }
    preview.hidden = false;
    const r = btn.getBoundingClientRect();
    const pr = preview.getBoundingClientRect();
    preview.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - pr.width / 2, innerWidth - pr.width - 8))}px`;
  }, 350);
});
$('#taskbar-apps').addEventListener('pointerleave', () => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => { if (!preview.matches(':hover')) preview.hidden = true; }, 200);
});
preview.addEventListener('pointerleave', () => { preview.hidden = true; });
preview.addEventListener('click', (e) => {
  const id = e.target.closest('.pv-win')?.dataset.id;
  preview.hidden = true;
  if (id) wm.focus(id);
});

// Minimizing animates the window into its taskbar button.
wm.minimizeTarget = (appId) => document.querySelector(`#taskbar-apps .tb-btn[data-id="${appId}"]`)?.getBoundingClientRect();

async function start() {
  applyWallpaper();
  tickClock();
  setInterval(tickClock, 10_000);
  const params = new URLSearchParams(location.search);
  const res = await fetch('/apps/registry.json');
  apps = (await res.json()).apps;
  icons.render(apps.filter((a) => a.desktop));
  widgets = new Widgets({ apps, openApp });
  renderTaskbar();
  await boot({ skip: params.has('open') });
  // Deep link: /?open=webkart or /?open=notepad,calculator
  const open = params.get('open');
  if (open) open.split(',').forEach((id) => openApp(id.trim()));
  if (!store.get('win11web.welcomed', '')) {
    store.set('win11web.welcomed', '1');
    panels.notify('Win11 Web에 오신 것을 환영합니다', '아이콘을 두 번 클릭해 앱을 여세요. 창 최대화 버튼에 마우스를 올리면 창 배치를 고를 수 있어요.');
  }
}

start();
