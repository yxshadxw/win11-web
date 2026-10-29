// Online water-balloon rooms for up to four players. The server runs the round at a fixed
// tick with the same rules module the browser uses, takes only key presses from players,
// and streams the resulting state to everyone in the room with Server-Sent Events.
import { randomBytes, randomInt } from 'node:crypto';
import { createGame, step, LAYOUTS, COLORS } from './public/apps/balloon/rules.js';
import { createBrain, botInput } from './public/apps/balloon/ai.js';

export const TICK = 1 / 20;
const ROOM_IDLE_MS = 60 * 60_000;
const MAX_ROOMS = 300;
const SEATS = 4;
const INPUTS_PER_SECOND = 40;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I lookalikes
const DIRS = new Set(['up', 'down', 'left', 'right']);
const rooms = new Map();

export class BalloonError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function newCode() {
  for (;;) {
    const code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
    if (!rooms.has(code)) return code;
  }
}

const newToken = () => randomBytes(18).toString('base64url');
const cleanName = (name, fallback) => String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) || fallback;

function sweep(now = Date.now()) {
  for (const [code, room] of rooms) {
    if (now - room.active > ROOM_IDLE_MS && room.clients.size === 0) closeRoom(code);
  }
}

function closeRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  clearInterval(room.loop);
  rooms.delete(code);
  for (const c of room.clients) c.res.end();
}

function seatFor(name, token = newToken()) {
  return { token, name, input: { dir: null, place: false }, budget: { at: Date.now(), left: INPUTS_PER_SECOND } };
}

export function createRoom({ name } = {}) {
  sweep();
  if (rooms.size >= MAX_ROOMS) throw new BalloonError(503, '지금은 방을 더 만들 수 없습니다. 잠시 후 다시 시도하세요.');
  const seat = seatFor(cleanName(name, '방장'));
  const room = {
    code: newCode(), seats: [seat], host: seat.token, clients: new Set(), active: Date.now(),
    phase: 'lobby', layout: 'pillars', bots: 0, game: null, brains: [], loop: null, sentMap: 0, round: 0, wins: [0, 0, 0, 0],
  };
  rooms.set(room.code, room);
  return { code: room.code, seat: 0, token: seat.token };
}

function getRoom(code) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) throw new BalloonError(404, '방을 찾을 수 없습니다. 코드를 확인하세요.');
  room.active = Date.now();
  return room;
}

const seatOf = (room, token) => (token ? room.seats.findIndex((s) => s.token === token) : -1);

export function joinRoom(code, token, name) {
  const room = getRoom(code);
  const existing = seatOf(room, token);
  if (existing >= 0) return { code: room.code, seat: existing, token };
  purge(room);
  if (room.phase !== 'playing' && room.seats.length < SEATS) {
    const seat = seatFor(cleanName(name, `${room.seats.length + 1}P`));
    room.seats.push(seat);
    room.bots = Math.min(room.bots, SEATS - room.seats.length);
    broadcastRoom(room);
    return { code: room.code, seat: room.seats.length - 1, token: seat.token };
  }
  return { code: room.code, seat: -1, token: null };
}

/** The lobby view: who sits where. Never includes tokens. */
export function roomView(room) {
  const connected = new Set([...room.clients].map((c) => c.seat));
  return {
    code: room.code, phase: room.phase, layout: room.layout, bots: room.bots, round: room.round,
    seats: room.seats.map((s, i) => ({ name: s.name, color: COLORS[i], host: s.token === room.host, connected: connected.has(i), gone: s.gone, wins: room.wins[i] })),
  };
}

/** One tick of the round, compact. The map only goes out when it changed. */
export function frame(room, full = false) {
  const g = room.game;
  if (!g) return null;
  const out = {
    t: +g.time.toFixed(2), limit: g.limit, phase: g.phase, winner: g.winner, mv: g.mapVersion, closed: g.closed,
    players: g.players.map((p) => ({
      name: p.name, color: p.color, bot: p.bot, x: +p.x.toFixed(3), y: +p.y.toFixed(3), dir: p.dir, moving: p.moving,
      alive: p.alive, trapped: +p.trapped.toFixed(2), count: p.count, range: p.range, speed: p.speed, pops: p.pops,
    })),
    balloons: g.balloons.map((b) => [b.x, b.y, +b.timer.toFixed(2), b.owner]),
    bursts: g.bursts.map((s) => [s.x, s.y, +s.t.toFixed(2)]),
    events: g.events,
  };
  if (full || room.sentMap !== g.mapVersion) {
    out.tiles = g.tiles.join('');
    out.items = g.items.map((it) => (it ? it[0] : '.')).join('');
  }
  return out;
}

const write = (client, event, data) => client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

function broadcastRoom(room) {
  const view = roomView(room);
  for (const c of room.clients) write(c, 'room', view);
}

function broadcastFrame(room) {
  const data = frame(room);
  room.sentMap = room.game.mapVersion;
  for (const c of room.clients) write(c, 'frame', data);
}

/** Run one server tick. Exported so tests can drive rounds without timers. */
export function tick(room) {
  const g = room.game;
  if (!g || g.phase !== 'playing') return;
  const connected = new Set([...room.clients].map((c) => c.seat));
  const inputs = g.players.map((p, i) => {
    const seat = room.seats[i];
    // Bots, and players whose connection dropped, are driven by the computer.
    if (!seat || !connected.has(i)) return botInput(g, i, room.brains[i], TICK);
    const input = { ...seat.input };
    seat.input.place = false;
    return input;
  });
  g.events = [];
  step(g, TICK, inputs);
  if (g.phase === 'over') {
    clearInterval(room.loop);
    room.loop = null;
    room.phase = 'over';
    if (g.winner !== null) room.wins[g.winner]++;
  }
}

export function startRound(code, token, { layout, bots } = {}) {
  const room = getRoom(code);
  if (seatOf(room, token) < 0) throw new BalloonError(403, '이 방의 플레이어가 아닙니다.');
  if (token !== room.host) throw new BalloonError(403, '방장만 시작할 수 있습니다.');
  if (room.phase === 'playing') throw new BalloonError(409, '이미 게임이 진행 중입니다.');
  purge(room);
  if (layout in LAYOUTS) room.layout = layout;
  if (Number.isInteger(bots)) room.bots = Math.max(0, Math.min(SEATS - room.seats.length, bots));
  const players = room.seats.length + room.bots;
  if (players < 2) throw new BalloonError(409, '두 명 이상이어야 합니다. 친구를 부르거나 컴퓨터를 넣어 주세요.');
  const names = [...room.seats.map((s) => s.name), ...Array.from({ length: room.bots }, (_, i) => `컴퓨터 ${i + 1}`)];
  const isBot = names.map((_, i) => i >= room.seats.length);
  room.game = createGame({ players, names, bots: isBot, layout: room.layout, seed: randomInt(2 ** 31) });
  room.brains = room.game.players.map(() => createBrain('normal'));
  for (const s of room.seats) s.input = { dir: null, place: false };
  room.phase = 'playing';
  room.round++;
  room.sentMap = 0;
  broadcastRoom(room);
  clearInterval(room.loop);
  room.loop = setInterval(() => {
    tick(room);
    broadcastFrame(room);
    if (room.phase === 'over') broadcastRoom(room);
  }, TICK * 1000);
  room.loop.unref?.();
}

/** Lobby settings (host only), so everyone sees the choice before the round starts. */
export function configure(code, token, { layout, bots }) {
  const room = getRoom(code);
  if (token !== room.host || seatOf(room, token) < 0) throw new BalloonError(403, '방장만 바꿀 수 있습니다.');
  if (layout in LAYOUTS) room.layout = layout;
  if (Number.isInteger(bots)) room.bots = Math.max(0, Math.min(SEATS - room.seats.length, bots));
  broadcastRoom(room);
}

export function setInput(code, token, { dir, place }) {
  const room = getRoom(code);
  const i = seatOf(room, token);
  if (i < 0) throw new BalloonError(403, '이 방의 플레이어가 아닙니다.');
  const seat = room.seats[i];
  const now = Date.now();
  if (now - seat.budget.at >= 1000) seat.budget = { at: now, left: INPUTS_PER_SECOND };
  if (seat.budget.left-- <= 0) throw new BalloonError(429, '입력이 너무 많습니다.');
  seat.input.dir = DIRS.has(dir) ? dir : null;
  // A press is latched until the next tick so a quick tap is never lost.
  if (place) seat.input.place = true;
}

/** Drop seats of players who left during the last round, once it is over. */
function purge(room) {
  if (room.phase === 'playing') return;
  for (let i = room.seats.length - 1; i >= 0; i--) {
    if (!room.seats[i].gone) continue;
    room.seats.splice(i, 1);
    room.wins.splice(i, 1);
    room.wins.push(0);
    for (const c of room.clients) {
      if (c.seat === i) c.seat = -1;
      else if (c.seat > i) c.seat--;
      write(c, 'hello', { seat: c.seat });
    }
  }
  room.bots = Math.min(room.bots, SEATS - room.seats.length);
}

export function leaveRoom(code, token) {
  const room = getRoom(code);
  const i = seatOf(room, token);
  if (i < 0) return;
  // Mid-round the seat stays (a bot takes over) so player numbers do not shift.
  room.seats[i].gone = true;
  room.seats[i].token = newToken();
  for (const c of room.clients) if (c.seat === i) c.seat = -1;
  if (token === room.host) room.host = room.seats.find((s) => !s.gone)?.token || null;
  if (!room.host) return closeRoom(room.code);
  purge(room);
  broadcastRoom(room);
}

export function subscribe(code, token, res) {
  const room = getRoom(code);
  const client = { res, seat: seatOf(room, token) };
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    // no-transform keeps proxies from compressing (and so buffering) the stream
    'cache-control': 'no-store, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  room.clients.add(client);
  write(client, 'hello', { seat: client.seat });
  broadcastRoom(room);
  if (room.game) write(client, 'frame', frame(room, true));
  // Comments keep proxies from closing an idle stream.
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  res.on('close', () => {
    clearInterval(ping);
    room.clients.delete(client);
    room.active = Date.now();
    broadcastRoom(room);
  });
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024) throw new BalloonError(413, '요청이 너무 큽니다.');
  }
  try { return JSON.parse(body || '{}'); } catch { throw new BalloonError(400, '잘못된 요청입니다.'); }
}

/** Key presses arrive often, so the caller exempts `input` from the general rate limit. */
export const isInput = (pathname) => pathname === '/api/balloon/input';

export async function handleBalloon(req, res, pathname) {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  try {
    const url = new URL(req.url, 'http://local');
    const action = pathname.slice('/api/balloon/'.length);
    if (action === 'events' && req.method === 'GET') {
      return subscribe(url.searchParams.get('code'), url.searchParams.get('token'), res);
    }
    if (req.method !== 'POST') throw new BalloonError(405, '지원하지 않는 요청입니다.');
    const body = await readJson(req);
    if (action === 'create') return send(200, createRoom(body));
    if (action === 'join') return send(200, joinRoom(body.code, body.token, body.name));
    if (action === 'input') { setInput(body.code, body.token, body); return send(200, { ok: true }); }
    if (action === 'start') { startRound(body.code, body.token, body); return send(200, { ok: true }); }
    if (action === 'config') { configure(body.code, body.token, body); return send(200, { ok: true }); }
    if (action === 'leave') { leaveRoom(body.code, body.token); return send(200, { ok: true }); }
    throw new BalloonError(404, '알 수 없는 요청입니다.');
  } catch (err) {
    if (res.headersSent) return res.end();
    send(err instanceof BalloonError ? err.status : 500, { error: err instanceof BalloonError ? err.message : '서버 오류가 발생했습니다.' });
  }
}

/** For tests. */
export function _rooms() { return rooms; }
