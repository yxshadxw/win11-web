// Creates and manages app windows. Each window hosts its app page in an iframe.
import { appIcon } from './util.js';

const ICON = {
  min: '<svg viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor"/></svg>',
  max: '<svg viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" rx="1" fill="none" stroke="currentColor"/></svg>',
  restore: '<svg viewBox="0 0 10 10"><rect x=".5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor"/><path d="M2.5 2.5v-1a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" fill="none" stroke="currentColor"/></svg>',
  close: '<svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg>',
  popout: '<svg viewBox="0 0 10 10"><path d="M4 1H1v8h8V6M6 .5h3.5V4M9.5.5 5 5" fill="none" stroke="currentColor"/></svg>',
};
const SNAP_EDGE = 8;
// Snap Layouts flyout: each layout is a list of zones as [x, y, w, h] fractions of the desktop.
const LAYOUTS = [
  [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
  [[0, 0, 2 / 3, 1], [2 / 3, 0, 1 / 3, 1]],
  [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]],
  [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
];

export class WindowManager extends EventTarget {
  constructor(layer, snapPreview) {
    super();
    this.layer = layer;
    this.snapPreview = snapPreview;
    this.windows = new Map();
    this.z = 10;
    this.seq = 0;
    this.activeId = null;

    // Clicking into an iframe doesn't bubble to us; the parent window blurs instead.
    window.addEventListener('blur', () => setTimeout(() => {
      const el = document.activeElement;
      if (el?.tagName === 'IFRAME') {
        const win = el.closest('.window');
        if (win) this.focus(win.dataset.id);
      }
    }));
  }

  bounds() {
    return this.layer.getBoundingClientRect();
  }

  isCompact() {
    return window.innerWidth <= 640;
  }

  open(app) {
    const id = `w${++this.seq}`;
    const area = this.bounds();
    const width = Math.min(app.width || 800, area.width - 20);
    const height = Math.min(app.height || 560, area.height - 20);
    const offset = (this.windows.size % 8) * 28;
    const x = Math.max(0, Math.round((area.width - width) / 2) - 100 + offset);
    const y = Math.max(0, Math.round((area.height - height) / 2) - 60 + offset);

    const el = document.createElement('section');
    el.className = 'window';
    el.dataset.id = id;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', app.name);
    el.innerHTML = `
      <header class="titlebar">
        <span class="t-icon" aria-hidden="true"></span>
        <span class="t-title"></span>
        <button class="t-btn" data-act="popout" type="button" title="새 탭에서 열기" aria-label="새 탭에서 열기">${ICON.popout}</button>
        <button class="t-btn" data-act="min" type="button" title="최소화" aria-label="최소화">${ICON.min}</button>
        <button class="t-btn" data-act="max" type="button" title="최대화" aria-label="최대화">${ICON.max}</button>
        <button class="t-btn close" data-act="close" type="button" title="닫기" aria-label="닫기">${ICON.close}</button>
      </header>
      <div class="window-body"><iframe allow="fullscreen; autoplay; clipboard-write; gamepad"></iframe></div>
      ${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((d) => `<div class="resize ${d}" data-dir="${d}"></div>`).join('')}`;
    el.querySelector('.t-icon').replaceWith(appIcon(app, 16));
    el.querySelector('.t-title').textContent = app.name;
    const iframe = el.querySelector('iframe');
    iframe.title = app.name;
    if (app.sandbox) iframe.setAttribute('sandbox', app.sandbox);
    iframe.src = app.url;

    const state = { id, app, el, iframe, x, y, width, height, maximized: false, minimized: false, restore: null };
    this.windows.set(id, state);
    this.applyRect(state);
    this.layer.append(el);
    if (this.isCompact()) this.maximize(id, true);

    iframe.addEventListener('load', () => {
      // Same-origin app pages can report their own title (e.g. Explorer -> Notepad).
      try {
        const title = iframe.contentDocument?.title;
        if (title) el.querySelector('.t-title').textContent = title;
      } catch { /* cross-origin frame */ }
    });

    el.addEventListener('pointerdown', () => this.focus(id));
    el.querySelector('.titlebar').addEventListener('pointerdown', (e) => this.startDrag(e, state));
    el.querySelector('.titlebar').addEventListener('dblclick', (e) => {
      if (!e.target.closest('.t-btn')) this.toggleMaximize(id);
    });
    el.querySelectorAll('.resize').forEach((h) => h.addEventListener('pointerdown', (e) => this.startResize(e, state, h.dataset.dir)));
    el.querySelector('.titlebar').addEventListener('click', (e) => {
      const act = e.target.closest('.t-btn')?.dataset.act;
      if (act === 'close') this.close(id);
      else if (act === 'min') this.minimize(id);
      else if (act === 'max') this.toggleMaximize(id);
      else if (act === 'popout') this.popout(id);
    });

    this.bindSnapFlyout(state);
    this.focus(id);
    this.emit();
    return id;
  }

  applyRect(s) {
    const st = s.el.style;
    if (s.maximized) {
      Object.assign(st, { left: '0px', top: '0px', width: '100%', height: '100%' });
    } else {
      Object.assign(st, { left: `${s.x}px`, top: `${s.y}px`, width: `${s.width}px`, height: `${s.height}px` });
    }
    const btn = s.el.querySelector('[data-act="max"]');
    btn.innerHTML = s.maximized ? ICON.restore : ICON.max;
    btn.title = s.maximized ? '이전 크기로' : '최대화';
    s.el.classList.toggle('maximized', s.maximized);
  }

  focus(id) {
    const s = this.windows.get(id);
    if (!s) return;
    if (s.minimized) {
      s.minimized = false;
      s.el.classList.remove('minimized');
    }
    if (this.activeId !== id) s.el.style.zIndex = String(++this.z);
    this.activeId = id;
    for (const w of this.windows.values()) w.el.classList.toggle('inactive', w.id !== id);
    this.emit();
  }

  topVisible(exceptId) {
    let best = null;
    for (const w of this.windows.values()) {
      if (w.id === exceptId || w.minimized) continue;
      if (!best || Number(w.el.style.zIndex) > Number(best.el.style.zIndex)) best = w;
    }
    return best;
  }

  blurTo(exceptId) {
    const next = this.topVisible(exceptId);
    this.activeId = null;
    if (next) this.focus(next.id);
    else {
      for (const w of this.windows.values()) w.el.classList.add('inactive');
      this.emit();
    }
  }

  minimize(id) {
    const s = this.windows.get(id);
    if (!s) return;
    s.minimized = true;
    s.el.classList.add('minimized');
    this.blurTo(id);
  }

  maximize(id, value) {
    const s = this.windows.get(id);
    if (!s) return;
    if (value && !s.maximized) s.restore = { x: s.x, y: s.y, width: s.width, height: s.height };
    if (!value && s.restore) Object.assign(s, s.restore);
    s.maximized = value;
    this.applyRect(s);
  }

  toggleMaximize(id) {
    const s = this.windows.get(id);
    if (s) this.maximize(id, !s.maximized);
  }

  close(id) {
    const s = this.windows.get(id);
    if (!s) return;
    this.windows.delete(id);
    s.el.classList.add('closing');
    setTimeout(() => s.el.remove(), 130);
    if (this.activeId === id) this.blurTo(id);
    else this.emit();
  }

  popout(id) {
    const s = this.windows.get(id);
    if (!s) return;
    let url = s.app.url;
    try {
      const href = s.iframe.contentWindow.location.href;
      if (href && href !== 'about:blank') url = href;
    } catch { /* cross-origin: fall back to the app URL */ }
    window.open(url, '_blank', 'noopener');
  }

  /** Taskbar click: focus, or minimize if it's already the active window. */
  toggleFromTaskbar(id) {
    const s = this.windows.get(id);
    if (!s) return;
    if (this.activeId === id && !s.minimized) this.minimize(id);
    else this.focus(id);
  }

  closeApp(appId) {
    for (const w of this.findByApp(appId)) this.close(w.id);
  }

  findByApp(appId) {
    return [...this.windows.values()].filter((w) => w.app.id === appId);
  }

  shield(cursor) {
    const div = document.createElement('div');
    div.className = 'drag-shield';
    div.style.cursor = cursor;
    document.body.append(div);
    return div;
  }

  startDrag(e, s) {
    if (e.button !== 0 || e.target.closest('.t-btn')) return;
    const area = this.bounds();
    const startX = e.clientX;
    const startY = e.clientY;
    let origin = { x: s.x, y: s.y };
    let moved = false;
    let snap = null;
    const shield = this.shield('default');

    const move = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved && s.maximized) {
        // Pull a maximized window out under the cursor, keeping the grab point proportional.
        const ratio = (startX - area.left) / area.width;
        s.maximized = false;
        if (s.restore) Object.assign(s, { width: s.restore.width, height: s.restore.height });
        origin = { x: startX - area.left - s.width * ratio, y: 0 };
      }
      moved = true;
      s.x = Math.round(origin.x + dx);
      s.y = Math.round(Math.max(0, Math.min(area.height - 34, origin.y + dy)));
      this.applyRect(s);

      const px = ev.clientX - area.left;
      const py = ev.clientY - area.top;
      snap = py <= SNAP_EDGE ? 'max' : px <= SNAP_EDGE ? 'left' : px >= area.width - SNAP_EDGE ? 'right' : null;
      this.showSnap(snap, area);
    };
    const up = () => {
      shield.remove();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.showSnap(null);
      if (!snap) return;
      s.restore = { x: s.x, y: Math.max(0, s.y), width: s.width, height: s.height };
      if (snap === 'max') {
        this.maximize(s.id, true);
        return;
      }
      s.y = 0;
      s.width = Math.round(area.width / 2);
      s.height = Math.round(area.height);
      s.x = snap === 'left' ? 0 : Math.round(area.width / 2);
      this.applyRect(s);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  showSnap(kind, area) {
    const p = this.snapPreview;
    if (!kind) { p.hidden = true; return; }
    const half = area.width / 2;
    const rect = kind === 'max' ? [0, 0, area.width, area.height]
      : kind === 'left' ? [0, 0, half, area.height] : [half, 0, half, area.height];
    Object.assign(p.style, {
      left: `${rect[0]}px`, top: `${rect[1]}px`,
      width: `${rect[2] - 12}px`, height: `${rect[3] - 12}px`, zIndex: String(this.z + 1),
    });
    p.hidden = false;
  }

  startResize(e, s, dir) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, left: s.x, top: s.y, width: s.width, height: s.height };
    const shield = this.shield(getComputedStyle(e.target).cursor);
    const MIN_W = 280;
    const MIN_H = 180;
    const move = (ev) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (dir.includes('e')) s.width = Math.max(MIN_W, start.width + dx);
      if (dir.includes('s')) s.height = Math.max(MIN_H, start.height + dy);
      if (dir.includes('w')) {
        s.width = Math.max(MIN_W, start.width - dx);
        s.x = start.left + start.width - s.width;
      }
      if (dir.includes('n')) {
        s.height = Math.max(MIN_H, start.height - dy);
        s.y = Math.max(0, start.top + start.height - s.height);
      }
      this.applyRect(s);
    };
    const up = () => {
      shield.remove();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Places a window into a zone given as fractions of the desktop. */
  placeInZone(id, [fx, fy, fw, fh]) {
    const s = this.windows.get(id);
    if (!s) return;
    const area = this.bounds();
    if (!s.maximized) s.restore = { x: s.x, y: s.y, width: s.width, height: s.height };
    s.maximized = false;
    Object.assign(s, {
      x: Math.round(area.width * fx), y: Math.round(area.height * fy),
      width: Math.round(area.width * fw), height: Math.round(area.height * fh),
    });
    this.applyRect(s);
    this.focus(id);
  }

  /** Hovering the maximize button shows the Snap Layouts flyout, like Windows 11. */
  bindSnapFlyout(s) {
    const btn = s.el.querySelector('[data-act="max"]');
    let timer = null;
    let flyout = null;
    const close = () => { flyout?.remove(); flyout = null; };
    const show = () => {
      if (this.isCompact()) return;
      close();
      flyout = document.createElement('div');
      flyout.className = 'snap-flyout';
      flyout.setAttribute('role', 'menu');
      flyout.setAttribute('aria-label', '창 배치');
      LAYOUTS.forEach((zones) => {
        const layout = document.createElement('div');
        layout.className = 'snap-layout';
        for (const zone of zones) {
          const z = document.createElement('button');
          z.type = 'button';
          z.className = 'snap-zone';
          z.setAttribute('role', 'menuitem');
          z.setAttribute('aria-label', '이 영역에 배치');
          Object.assign(z.style, {
            left: `${zone[0] * 100}%`, top: `${zone[1] * 100}%`,
            width: `${zone[2] * 100}%`, height: `${zone[3] * 100}%`,
          });
          z.addEventListener('click', (e) => { e.stopPropagation(); close(); this.placeInZone(s.id, zone); });
          layout.append(z);
        }
        flyout.append(layout);
      });
      const r = btn.getBoundingClientRect();
      flyout.style.top = `${r.bottom + 6}px`;
      flyout.style.left = `${Math.min(r.left - 120, innerWidth - 320)}px`;
      flyout.addEventListener('pointerleave', close);
      document.body.append(flyout);
    };
    btn.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') timer = setTimeout(show, 450);
    });
    btn.addEventListener('pointerleave', (e) => {
      clearTimeout(timer);
      // Keep the flyout open while the pointer moves into it.
      setTimeout(() => { if (flyout && !flyout.matches(':hover')) close(); }, 120);
    });
    btn.addEventListener('click', () => { clearTimeout(timer); close(); });
  }

  emit() {
    this.dispatchEvent(new Event('change'));
  }
}
