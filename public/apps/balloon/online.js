// Online rooms: the server (/api/balloon) runs the round; this side only sends key presses
// and turns the streamed frames back into a game-shaped object the renderer understands.
import { W, H } from './rules.js';

const SEAT_KEY = 'win11web.balloon.seat';
const ITEM = { c: 'count', r: 'range', s: 'speed' };

async function post(action, body) {
  const res = await fetch(`/api/balloon/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '서버에 연결하지 못했습니다.');
  return data;
}

export class Online {
  constructor({ onRoom, onFrame, onError }) {
    Object.assign(this, { onRoom, onFrame, onError });
    this.active = false;
    this.code = null;
    this.seat = -1;
    this.token = null;
    this.room = null;
    this.game = null;
    this.events = null;
    this.sending = false;
    this.wanted = { dir: null, place: false };
    this.sent = { dir: null };
  }

  /** Remembers this tab's seat so a reload rejoins as the same player. */
  saveSeat() {
    try { sessionStorage.setItem(SEAT_KEY, JSON.stringify({ code: this.code, token: this.token })); } catch { /* optional */ }
  }

  savedToken(code) {
    try {
      const seat = JSON.parse(sessionStorage.getItem(SEAT_KEY));
      return seat?.code === code ? seat.token : null;
    } catch { return null; }
  }

  async create(name) { this.enter(await post('create', { name })); }

  async join(code, name) {
    const clean = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(clean)) throw new Error('방 코드는 6자리입니다.');
    this.enter(await post('join', { code: clean, token: this.savedToken(clean), name }));
  }

  enter({ code, seat, token }) {
    this.close();
    Object.assign(this, { active: true, code, seat, token });
    this.saveSeat();
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    history.replaceState(null, '', url);
    const q = new URLSearchParams({ code, ...(token ? { token } : {}) });
    this.events = new EventSource(`/api/balloon/events?${q}`);
    this.events.addEventListener('hello', (e) => { this.seat = JSON.parse(e.data).seat; });
    this.events.addEventListener('room', (e) => { this.room = JSON.parse(e.data); this.onRoom(this.room); });
    this.events.addEventListener('frame', (e) => this.apply(JSON.parse(e.data)));
    this.events.onerror = () => {
      // EventSource reconnects by itself; only report when it has given up.
      if (this.events?.readyState === EventSource.CLOSED) this.onError('서버와 연결이 끊겼습니다.');
    };
  }

  apply(f) {
    const prev = this.game;
    const game = {
      w: W, h: H, time: f.t, limit: f.limit, phase: f.phase, winner: f.winner, closed: f.closed,
      tiles: f.tiles ? [...f.tiles] : prev?.tiles, items: f.items ? [...f.items].map((c) => ITEM[c] || null) : prev?.items,
      mapVersion: f.mv, players: f.players,
      balloons: f.balloons.map(([x, y, timer, owner]) => ({ x, y, timer, owner })),
      bursts: f.bursts.map(([x, y, t]) => ({ x, y, t })),
      events: f.events || [],
    };
    this.game = game;
    this.onFrame(game);
  }

  get isPlayer() { return this.seat >= 0; }
  get isHost() { return Boolean(this.room?.seats[this.seat]?.host); }

  /** Sends the held direction and balloon presses one request at a time, newest wins. */
  input(dir, place = false) {
    if (!this.active || !this.isPlayer) return;
    this.wanted.dir = dir;
    if (place) this.wanted.place = true;
    this.flush();
  }

  async flush() {
    if (this.sending) return;
    const { dir, place } = this.wanted;
    if (dir === this.sent.dir && !place) return;
    this.sending = true;
    this.wanted.place = false;
    try {
      await post('input', { code: this.code, token: this.token, dir, place });
      this.sent.dir = dir;
    } catch { /* the next press retries */ }
    this.sending = false;
    if (this.wanted.place || this.wanted.dir !== this.sent.dir) this.flush();
  }

  start(options) { return post('start', { code: this.code, token: this.token, ...options }); }
  configure(options) { return post('config', { code: this.code, token: this.token, ...options }); }

  link() { return `${location.origin}/apps/balloon/?room=${this.code}`; }

  close() {
    this.events?.close();
    this.events = null;
    this.active = false;
    this.room = null;
    this.game = null;
    this.sent = { dir: null };
    this.wanted = { dir: null, place: false };
  }

  leave() {
    if (this.active && this.token) post('leave', { code: this.code, token: this.token }).catch(() => {});
    try { sessionStorage.removeItem(SEAT_KEY); } catch { /* optional */ }
    this.close();
    const url = new URL(location.href);
    if (url.searchParams.has('room')) {
      url.searchParams.delete('room');
      history.replaceState(null, '', url);
    }
  }
}
