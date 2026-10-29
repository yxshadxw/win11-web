// Online play: talks to /api/chess on the server, which owns the game and validates moves.
const SEAT_KEY = 'win11web.chess.seat';

async function post(action, body) {
  const res = await fetch(`/api/chess/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '서버에 연결하지 못했습니다.');
  return data;
}

export class Online {
  constructor({ onState, onError }) {
    this.onState = onState;
    this.onError = onError;
    this.active = false;
    this.code = null;
    this.color = null;
    this.token = null;
    this.snap = null;
    this.events = null;
  }

  /** Remembers this tab's seat so a reload rejoins as the same player. */
  saveSeat() {
    try { sessionStorage.setItem(SEAT_KEY, JSON.stringify({ code: this.code, token: this.token })); } catch { /* ignore */ }
  }

  savedToken(code) {
    try {
      const seat = JSON.parse(sessionStorage.getItem(SEAT_KEY));
      return seat?.code === code ? seat.token : null;
    } catch { return null; }
  }

  async create() {
    this.enter(await post('create', {}));
  }

  async join(code) {
    const clean = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(clean)) throw new Error('방 코드는 6자리입니다.');
    this.enter(await post('join', { code: clean, token: this.savedToken(clean) }));
  }

  enter({ code, color, token }) {
    this.leave();
    Object.assign(this, { active: true, code, color, token });
    this.saveSeat();
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    history.replaceState(null, '', url);
    this.connect();
  }

  connect() {
    const q = new URLSearchParams({ code: this.code, ...(this.token ? { token: this.token } : {}) });
    this.events = new EventSource(`/api/chess/events?${q}`);
    this.events.addEventListener('state', (e) => {
      this.snap = JSON.parse(e.data);
      this.onState(this.snap);
    });
    // After a rematch the server swaps colors.
    this.events.addEventListener('color', (e) => { this.color = JSON.parse(e.data).color; });
    this.events.onerror = () => {
      // EventSource reconnects by itself; only report when it has given up.
      if (this.events?.readyState === EventSource.CLOSED) this.onError('서버와 연결이 끊겼습니다.');
    };
  }

  leave() {
    this.events?.close();
    this.events = null;
    this.active = false;
    this.snap = null;
    const url = new URL(location.href);
    if (url.searchParams.has('room')) {
      url.searchParams.delete('room');
      history.replaceState(null, '', url);
    }
  }

  get isPlayer() { return this.color === 'w' || this.color === 'b'; }

  canMove(turn) {
    return this.active && this.isPlayer && this.snap?.status === 'playing' && this.snap.joined.b && turn === this.color;
  }

  async send(move) {
    await post('move', { code: this.code, token: this.token, from: move.from, to: move.to, promotion: move.promotion || null });
  }

  resign() { return post('resign', { code: this.code, token: this.token }); }

  rematch() { return post('rematch', { code: this.code, token: this.token }); }

  link() {
    return `${location.origin}/apps/chess/?room=${this.code}`;
  }

  /** One line describing the room for the status bar. */
  describe(statusLabels) {
    const s = this.snap;
    if (!s) return '방에 연결하는 중…';
    const me = { w: '백', b: '흑' }[this.color];
    const who = this.isPlayer ? `나: ${me}` : '관전 중';
    if (!s.joined.b) return `상대를 기다리는 중 · 코드 ${s.code}`;
    const opp = this.isPlayer ? (this.color === 'w' ? 'b' : 'w') : null;
    const away = opp && !s.connected[opp] ? ' · 상대 연결 끊김' : '';
    if (s.status === 'resign-w' || s.status === 'resign-b') {
      const loser = s.status === 'resign-w' ? '백' : '흑';
      return `${loser} 기권 · ${who}`;
    }
    if (s.status === 'checkmate') {
      const winner = s.turn === 'w' ? '흑' : '백';
      return `체크메이트 · ${winner} 승리 · ${who}`;
    }
    if (s.status !== 'playing') return `${statusLabels[s.status] || '대국 종료'} · ${who}`;
    const mine = this.isPlayer && s.turn === this.color;
    return `${mine ? '내 차례' : this.isPlayer ? '상대 차례' : `${s.turn === 'w' ? '백' : '흑'} 차례`}${s.check ? ' · 체크' : ''} · ${who}${away}`;
  }
}
