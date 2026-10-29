// Desktop icons on a snapping grid. Icons can be dragged to any free cell; positions persist.
import { appIcon, store } from './util.js';

const POS_KEY = 'win11web.iconPositions';
const CELL_W = 84;
const CELL_H = 96;
const PAD = 8;

export class DesktopIcons {
  constructor(list, { onOpen }) {
    this.list = list;
    this.onOpen = onOpen;
    this.apps = [];
    this.positions = store.getJSON(POS_KEY, {});
    window.addEventListener('resize', () => this.layout());

    list.addEventListener('dblclick', (e) => {
      const btn = e.target.closest('.desk-icon');
      if (btn) this.onOpen(btn.dataset.id);
    });
    list.addEventListener('keydown', (e) => {
      const btn = e.target.closest('.desk-icon');
      if (btn && e.key === 'Enter') { e.preventDefault(); this.onOpen(btn.dataset.id); }
    });
    list.addEventListener('pointerdown', (e) => this.startDrag(e));
  }

  rows() {
    return Math.max(1, Math.floor((this.list.clientHeight - PAD * 2) / CELL_H));
  }

  cols() {
    return Math.max(1, Math.floor((this.list.clientWidth - PAD * 2) / CELL_W));
  }

  /** Column-first like Windows: fill down, then the next column. */
  cellOf(index) {
    const rows = this.rows();
    return { col: Math.floor(index / rows), row: index % rows };
  }

  render(apps) {
    this.apps = apps;
    this.list.replaceChildren(...apps.map((app) => {
      const li = document.createElement('li');
      li.className = 'desk-cell';
      li.dataset.id = app.id;
      const btn = document.createElement('button');
      btn.className = 'desk-icon';
      btn.type = 'button';
      btn.dataset.id = app.id;
      btn.title = `${app.name}\n${app.url}`;
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = app.name;
      btn.append(appIcon(app, 40), label);
      li.append(btn);
      return li;
    }));
    this.layout();
  }

  /** Places every icon at its saved cell, or the next free cell when it has none or it's off-screen. */
  layout() {
    const compact = window.innerWidth <= 640;
    this.list.classList.toggle('compact', compact);
    if (compact) return; // phones use a plain flowing grid
    const rows = this.rows();
    const cols = this.cols();
    const taken = new Set();
    const placed = new Map();
    for (const app of this.apps) {
      const p = this.positions[app.id];
      if (p && p.row < rows && p.col < cols && !taken.has(`${p.col},${p.row}`)) {
        taken.add(`${p.col},${p.row}`);
        placed.set(app.id, p);
      }
    }
    let next = 0;
    for (const app of this.apps) {
      if (placed.has(app.id)) continue;
      let cell;
      do cell = this.cellOf(next++); while (taken.has(`${cell.col},${cell.row}`));
      taken.add(`${cell.col},${cell.row}`);
      placed.set(app.id, cell);
    }
    for (const li of this.list.children) {
      const { col, row } = placed.get(li.dataset.id);
      li.style.transform = `translate(${PAD + col * CELL_W}px, ${PAD + row * CELL_H}px)`;
      li.dataset.col = col;
      li.dataset.row = row;
    }
  }

  select(id) {
    for (const b of this.list.querySelectorAll('.desk-icon')) b.classList.toggle('selected', b.dataset.id === id);
  }

  startDrag(e) {
    const li = e.target.closest('.desk-cell');
    this.select(li?.dataset.id);
    if (!li || e.button !== 0) return;
    if (e.pointerType === 'touch') {
      // No double-click on touch screens: a tap opens.
      const up = () => { this.onOpen(li.dataset.id); };
      li.addEventListener('pointerup', up, { once: true });
      setTimeout(() => li.removeEventListener('pointerup', up), 400);
      return;
    }
    if (this.list.classList.contains('compact')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { col: Number(li.dataset.col), row: Number(li.dataset.row) };
    const listBox = this.list.getBoundingClientRect();
    let dragging = false;

    const move = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) < 5) return;
      dragging = true;
      li.classList.add('dragging');
      li.style.transform = `translate(${PAD + origin.col * CELL_W + dx}px, ${PAD + origin.row * CELL_H + dy}px)`;
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      li.classList.remove('dragging');
      if (!dragging) return;
      const col = Math.min(this.cols() - 1, Math.max(0, Math.round((ev.clientX - listBox.left - PAD - CELL_W / 2) / CELL_W)));
      const row = Math.min(this.rows() - 1, Math.max(0, Math.round((ev.clientY - listBox.top - PAD - CELL_H / 2) / CELL_H)));
      // Dropping onto another icon swaps the two.
      const other = [...this.list.children].find((c) => c !== li && Number(c.dataset.col) === col && Number(c.dataset.row) === row);
      this.snapshotPositions();
      if (other) this.positions[other.dataset.id] = origin;
      this.positions[li.dataset.id] = { col, row };
      store.setJSON(POS_KEY, this.positions);
      this.layout();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Freezes the current automatic layout so moving one icon doesn't reshuffle the others. */
  snapshotPositions() {
    for (const li of this.list.children) {
      this.positions[li.dataset.id] = { col: Number(li.dataset.col), row: Number(li.dataset.row) };
    }
  }

  resetPositions() {
    this.positions = {};
    store.setJSON(POS_KEY, {});
    this.layout();
  }
}
