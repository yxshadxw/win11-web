// Flyouts opened from the taskbar tray: quick settings and the notification center with a calendar.
import { $, store } from './util.js';

const BRIGHTNESS_KEY = 'win11web.brightness';
const NIGHT_KEY = 'win11web.nightLight';
const NOTES_KEY = 'win11web.notifications';

export class Panels {
  constructor({ toggleTheme, cycleWallpaper, openApp }) {
    this.toggleTheme = toggleTheme;
    this.cycleWallpaper = cycleWallpaper;
    this.openApp = openApp;
    this.quick = $('#quick-settings');
    this.center = $('#notify-center');
    this.month = new Date();
    this.month.setDate(1);
    this.notes = store.getJSON(NOTES_KEY, []);

    this.applyDisplay();
    this.bindQuick();
    this.bindCenter();
    document.addEventListener('fullscreenchange', () => this.renderQuick());
  }

  /* ---------- open / close ---------- */
  toggle(panel) {
    const open = panel.hidden;
    this.closeAll();
    if (!open) return;
    $('#toasts').replaceChildren(); // toasts share the corner with the panels
    panel.hidden = false;
    if (panel === this.quick) this.renderQuick();
    else this.renderCenter();
    $(panel === this.quick ? '#tray-btn' : '#clock-btn').setAttribute('aria-expanded', 'true');
  }

  closeAll() {
    this.quick.hidden = true;
    this.center.hidden = true;
    $('#tray-btn').setAttribute('aria-expanded', 'false');
    $('#clock-btn').setAttribute('aria-expanded', 'false');
  }

  /* ---------- quick settings ---------- */
  applyDisplay() {
    const brightness = Number(store.get(BRIGHTNESS_KEY, '100'));
    const night = store.get(NIGHT_KEY, 'off') === 'on';
    const shade = $('#screen-shade');
    shade.style.setProperty('--dim', String((100 - brightness) / 100 * 0.7));
    shade.classList.toggle('night', night);
  }

  renderQuick() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const night = store.get(NIGHT_KEY, 'off') === 'on';
    const full = Boolean(document.fullscreenElement);
    for (const [act, on] of [['theme', dark], ['night', night], ['fullscreen', full]]) {
      this.quick.querySelector(`[data-act="${act}"]`).setAttribute('aria-pressed', String(on));
    }
    $('#brightness').value = store.get(BRIGHTNESS_KEY, '100');
  }

  bindQuick() {
    this.quick.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'theme') this.toggleTheme();
      else if (act === 'night') {
        store.set(NIGHT_KEY, store.get(NIGHT_KEY, 'off') === 'on' ? 'off' : 'on');
        this.applyDisplay();
      } else if (act === 'fullscreen') {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (act === 'wallpaper') this.cycleWallpaper();
      else if (act === 'settings') { this.closeAll(); this.openApp('settings'); return; }
      this.renderQuick();
    });
    $('#brightness').addEventListener('input', (e) => {
      store.set(BRIGHTNESS_KEY, e.target.value);
      this.applyDisplay();
    });
  }

  /* ---------- notification center ---------- */
  notify(title, body) {
    const note = { id: Date.now() + Math.random(), title: String(title).slice(0, 80), body: String(body || '').slice(0, 300), time: Date.now() };
    this.notes = [note, ...this.notes].slice(0, 30);
    store.setJSON(NOTES_KEY, this.notes);
    this.toast(note);
    this.updateBadge();
    if (!this.center.hidden) this.renderCenter();
  }

  toast(note) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    const t = document.createElement('strong');
    t.textContent = note.title;
    const b = document.createElement('p');
    b.textContent = note.body;
    el.append(t, b);
    $('#toasts').append(el);
    setTimeout(() => el.classList.add('leaving'), 4500);
    setTimeout(() => el.remove(), 4900);
  }

  updateBadge() {
    const badge = $('#notify-badge');
    badge.hidden = this.notes.length === 0;
    badge.textContent = String(Math.min(this.notes.length, 9));
  }

  renderCenter() {
    const list = $('#notify-list');
    if (!this.notes.length) {
      const li = document.createElement('li');
      li.className = 'notify-empty';
      li.textContent = '새 알림 없음';
      list.replaceChildren(li);
    } else {
      list.replaceChildren(...this.notes.map((n) => {
        const li = document.createElement('li');
        li.className = 'notify-item';
        const t = document.createElement('strong');
        t.textContent = n.title;
        const time = document.createElement('time');
        time.textContent = new Date(n.time).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
        const b = document.createElement('p');
        b.textContent = n.body;
        li.append(t, time, b);
        return li;
      }));
    }
    this.renderCalendar();
  }

  renderCalendar() {
    const today = new Date();
    const y = this.month.getFullYear();
    const m = this.month.getMonth();
    $('#cal-title').textContent = `${y}년 ${m + 1}월`;
    $('#cal-today').textContent = today.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const prevDays = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const day = i - first + 1;
      const td = document.createElement('span');
      td.className = 'cal-day';
      if (day < 1) { td.textContent = String(prevDays + day); td.classList.add('muted'); }
      else if (day > days) { td.textContent = String(day - days); td.classList.add('muted'); }
      else {
        td.textContent = String(day);
        if (y === today.getFullYear() && m === today.getMonth() && day === today.getDate()) {
          td.classList.add('today');
          td.setAttribute('aria-current', 'date');
        }
      }
      if (i % 7 === 0) td.classList.add('sun');
      cells.push(td);
    }
    $('#cal-grid').replaceChildren(...cells);
  }

  bindCenter() {
    $('#cal-prev').addEventListener('click', () => { this.month.setMonth(this.month.getMonth() - 1); this.renderCalendar(); });
    $('#cal-next').addEventListener('click', () => { this.month.setMonth(this.month.getMonth() + 1); this.renderCalendar(); });
    $('#notify-clear').addEventListener('click', () => {
      this.notes = [];
      store.setJSON(NOTES_KEY, []);
      this.updateBadge();
      this.renderCenter();
    });
    this.updateBadge();
  }
}
