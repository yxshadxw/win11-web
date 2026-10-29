// Online chess rooms. The server owns the game: it validates every move with the same rules
// module the browser uses, and pushes the room state to both players with Server-Sent Events.
import { randomBytes, randomInt } from 'node:crypto';
import { initial, legalMoves, play, status, notation } from './public/apps/chess/rules.js';

const ROOM_IDLE_MS = 2 * 60 * 60_000;
const MAX_ROOMS = 1000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I lookalikes
const rooms = new Map();

export class ChessError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function newCode() {
  for (;;) {
    const code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
    if (!rooms.has(code)) return code;
  }
}

const newToken = () => randomBytes(18).toString('base64url');

function sweep(now = Date.now()) {
  for (const [code, room] of rooms) {
    if (now - room.active > ROOM_IDLE_MS && room.clients.size === 0) rooms.delete(code);
  }
}

function resetGame(room) {
  room.state = initial();
  room.moves = [];
  room.notes = [];
  room.result = null;
  room.rematch = new Set();
}

export function createRoom() {
  sweep();
  if (rooms.size >= MAX_ROOMS) throw new ChessError(503, '지금은 방을 더 만들 수 없습니다. 잠시 후 다시 시도하세요.');
  const room = { code: newCode(), tokens: { w: newToken(), b: null }, clients: new Set(), active: Date.now() };
  resetGame(room);
  rooms.set(room.code, room);
  return { code: room.code, color: 'w', token: room.tokens.w };
}

function getRoom(code) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) throw new ChessError(404, '방을 찾을 수 없습니다. 코드를 확인하세요.');
  room.active = Date.now();
  return room;
}

function colorOf(room, token) {
  if (!token) return null;
  if (room.tokens.w === token) return 'w';
  if (room.tokens.b === token) return 'b';
  return null;
}

export function joinRoom(code, token) {
  const room = getRoom(code);
  const existing = colorOf(room, token);
  if (existing) return { code: room.code, color: existing, token };
  if (!room.tokens.b) {
    room.tokens.b = newToken();
    broadcast(room);
    return { code: room.code, color: 'b', token: room.tokens.b };
  }
  return { code: room.code, color: 'spectator', token: null };
}

/** Public view of a room: never includes tokens. */
export function snapshot(room) {
  const connected = { w: false, b: false };
  for (const c of room.clients) if (c.color === 'w' || c.color === 'b') connected[c.color] = true;
  return {
    code: room.code,
    moves: room.moves,
    notes: room.notes,
    turn: room.state.turn,
    status: room.result || status(room.state).kind,
    check: status(room.state).check,
    joined: { w: Boolean(room.tokens.w), b: Boolean(room.tokens.b) },
    connected,
    rematch: [...room.rematch],
  };
}

function broadcast(room) {
  const data = `event: state\ndata: ${JSON.stringify(snapshot(room))}\n\n`;
  for (const c of room.clients) c.res.write(data);
}

export function makeMove(code, token, { from, to, promotion }) {
  const room = getRoom(code);
  const color = colorOf(room, token);
  if (!color) throw new ChessError(403, '이 방의 플레이어가 아닙니다.');
  if (room.result || status(room.state).kind !== 'playing') throw new ChessError(409, '이미 끝난 대국입니다.');
  if (room.state.turn !== color) throw new ChessError(409, '상대 차례입니다.');
  if (!room.tokens.b) throw new ChessError(409, '상대가 아직 들어오지 않았습니다.');
  const move = legalMoves(room.state).find((m) => m.from === from && m.to === to && (m.promotion || null) === (promotion || null));
  if (!move) throw new ChessError(400, '둘 수 없는 수입니다.');
  room.notes.push(notation(room.state, move));
  room.state = play(room.state, move);
  room.moves.push({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
  broadcast(room);
  return snapshot(room);
}

export function resign(code, token) {
  const room = getRoom(code);
  const color = colorOf(room, token);
  if (!color) throw new ChessError(403, '이 방의 플레이어가 아닙니다.');
  if (!room.result && status(room.state).kind === 'playing') room.result = color === 'w' ? 'resign-w' : 'resign-b';
  broadcast(room);
}

/** Both players must ask; then colors swap and a new game starts. */
export function requestRematch(code, token) {
  const room = getRoom(code);
  const color = colorOf(room, token);
  if (!color) throw new ChessError(403, '이 방의 플레이어가 아닙니다.');
  if (!room.result && status(room.state).kind === 'playing') throw new ChessError(409, '대국이 끝난 뒤에 재대결할 수 있습니다.');
  room.rematch.add(color);
  if (room.rematch.size === 2) {
    room.tokens = { w: room.tokens.b, b: room.tokens.w };
    for (const c of room.clients) if (c.color === 'w' || c.color === 'b') c.color = c.color === 'w' ? 'b' : 'w';
    resetGame(room);
    for (const c of room.clients) c.res.write(`event: color\ndata: ${JSON.stringify({ color: c.color })}\n\n`);
  }
  broadcast(room);
}

export function subscribe(code, token, res) {
  const room = getRoom(code);
  const client = { res, color: colorOf(room, token) || 'spectator' };
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  room.clients.add(client);
  broadcast(room);
  // Comments keep proxies from closing an idle stream.
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  res.on('close', () => {
    clearInterval(ping);
    room.clients.delete(client);
    room.active = Date.now();
    broadcast(room);
  });
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2048) throw new ChessError(413, '요청이 너무 큽니다.');
  }
  try { return JSON.parse(body || '{}'); } catch { throw new ChessError(400, '잘못된 요청입니다.'); }
}

export async function handleChess(req, res, pathname) {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  try {
    const url = new URL(req.url, 'http://local');
    const action = pathname.slice('/api/chess/'.length);
    if (action === 'events' && req.method === 'GET') {
      return subscribe(url.searchParams.get('code'), url.searchParams.get('token'), res);
    }
    if (req.method !== 'POST') throw new ChessError(405, '지원하지 않는 요청입니다.');
    const body = await readJson(req);
    if (action === 'create') return send(200, createRoom());
    if (action === 'join') return send(200, joinRoom(body.code, body.token));
    if (action === 'move') {
      const from = Number(body.from);
      const to = Number(body.to);
      if (!Number.isInteger(from) || !Number.isInteger(to)) throw new ChessError(400, '잘못된 수입니다.');
      const promotion = ['q', 'r', 'b', 'n'].includes(body.promotion) ? body.promotion : null;
      return send(200, makeMove(body.code, body.token, { from, to, promotion }));
    }
    if (action === 'resign') { resign(body.code, body.token); return send(200, { ok: true }); }
    if (action === 'rematch') { requestRematch(body.code, body.token); return send(200, { ok: true }); }
    throw new ChessError(404, '알 수 없는 요청입니다.');
  } catch (err) {
    if (res.headersSent) return res.end();
    send(err instanceof ChessError ? err.status : 500, { error: err instanceof ChessError ? err.message : '서버 오류가 발생했습니다.' });
  }
}

/** For tests. */
export function _rooms() { return rooms; }
