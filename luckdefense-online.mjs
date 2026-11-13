// Real-time multiplayer backend for the ported "운빨 디펜스" (luckdefense) game.
//
// The game was handed to this repo as a static client export with no server source at all.
// The client bundle's simulation code (tower actions, monster waves, quiz questions) turned out
// to be plain, DOM-free logic bundled alongside its React UI, so rather than re-transcribing it
// by hand (and risking subtle mismatches with what the client expects), this module imports that
// exact bundle under a few minimal DOM shims and drives it directly. Only the session/room
// bookkeeping below -- which the original server must have owned and which the static export
// could never contain -- is new.
//
// Endpoints (reverse-engineered from the client's fetch call sites):
//   GET  /api/classes              -> { classes: [{ code, name, classNo, count, closed }] }
//   GET  /api/qr?class=CODE        -> QR image for the class invite link
//   POST /api/classroom  { action: 'create' | 'join' | 'peek' | 'sync' | 'inspect' | 'set-admission', ... }
//   POST /api/team        { action: 'create' | 'join' | 'sync' | 'peek' | 'start' | 'restart' |
//                            'build' | 'upgrade' | 'enhance' | 'demolish' | 'move' |
//                            'question' | 'answer' | 'skip-round' |
//                            'upgrade-meta-drop' | 'upgrade-meta-quiz' | 'upgrade-meta-kill' | 'upgrade-meta-wall', ... }

import { randomBytes, randomInt } from 'node:crypto';
import { serveCached } from './mirror.mjs';

// The bundle's simulation functions don't touch the DOM, but importing the module (which also
// holds its React UI) needs these globals to exist so top-level module evaluation doesn't throw.
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {} }),
    addEventListener() {},
    querySelector() { return null; },
    getElementsByTagName: () => [],
    head: { appendChild() {} },
    currentScript: null,
  };
}
if (typeof globalThis.location === 'undefined') {
  globalThis.location = { href: 'http://localhost/', origin: 'http://localhost', pathname: '/', search: '' };
}
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
}

const engineUrl = new URL(
  './public/apps/luckdefense/nx/static/chunks/classroom-BwhO2dwR.js',
  import.meta.url,
);
const engine = await import(engineUrl.href);
const newGame = engine.F; // (name, solo) => fresh game state
const applyAction = engine.V; // (game, seat, action, point, randomInt, aux) => tower | throws Error
const tick = engine.j; // (game, now) => boolean (state changed)
const quizRound = engine.X; // (game) => the round key quizzes are generated for
const makeQuiz = engine.g; // (seed, roundKey, seat, level) => quiz
const answerQuiz = engine.h; // (game, seat, quiz, answerIndex) => { correct, ... }
const startWave = engine.q; // (game, now) => undefined, mutates phase lobby/prepare -> wave
const restartGame = engine.U; // (game, autoRestart=false) => a brand-new game (only from phase 'defeat')
const skipRound = engine.skipRound; // (game, now) => force-finish the wave and start the next one
const metaUpgrade = engine.metaUpgrade; // (game, seat, key) => meta levels, throws Error

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Meta-upgrade shop (drop rate, quiz reward, kill reward, gate HP) and round skipping live in the
// engine bundle itself so the solo client and this server share one implementation.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I lookalikes
const MAX_ROOMS = 300;
const MAX_GROUPS = 8;
const SEATS_PER_GROUP = 4;
const ROOM_IDLE_MS = 4 * 60 * 60_000; // classrooms stay open 4 hours, matching the client's own copy
const TICK_MS = 240;

/** @type {Map<string, Room>} code -> room (both standalone teams and classrooms live here) */
const rooms = new Map();
/** @type {Map<string, {code:string, group:number, seat:number}>} token -> where that player sits */
const tokens = new Map();

function newCode() {
  for (;;) {
    const code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
    if (!rooms.has(code)) return code;
  }
}

const newToken = () => randomBytes(18).toString('base64url');
const cleanName = (name) => String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);

function makeGroup(group) {
  return { group, seats: Array(SEATS_PER_GROUP).fill(null), game: null, revision: 0, quizSeeds: new Map() };
}

/** A standalone team is a classroom-shaped room with exactly one group and no teacher. */
function createRoom({ kind, name, classNo = 0, hostToken }) {
  if (rooms.size >= MAX_ROOMS) throw new ApiError(503, '지금은 방을 더 만들 수 없습니다. 잠시 후 다시 시도하세요.');
  const room = {
    code: newCode(),
    kind, // 'team' | 'classroom'
    name: cleanName(name) || (kind === 'classroom' ? '우리 반' : '우리 팀'),
    classNo,
    hostToken,
    closed: false,
    ended: false,
    groups: kind === 'team' ? [makeGroup(1)] : Array.from({ length: MAX_GROUPS }, (_, i) => makeGroup(i + 1)),
    createdAt: Date.now(),
    lastActive: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function touch(room) { room.lastActive = Date.now(); }

function sweep(now = Date.now()) {
  for (const [code, room] of rooms) {
    if (now - room.lastActive > ROOM_IDLE_MS) {
      for (const g of room.groups) for (const seat of g.seats) if (seat) tokens.delete(seat.token);
      rooms.delete(code);
    }
  }
}

function groupSummary(room) {
  return room.groups
    .filter((g) => room.kind === 'team' || g.seats.some(Boolean) || g.game)
    .map((g) => ({ group: g.group, count: g.seats.filter(Boolean).length, phase: g.game?.phase ?? 'lobby' }));
}

function roomSummary(room) {
  const total = room.groups.reduce((n, g) => n + g.seats.filter(Boolean).length, 0);
  return { code: room.code, name: room.name, classNo: room.classNo, closed: room.closed, ended: room.ended, total, groups: groupSummary(room) };
}

/** Find the open seat with the smallest headcount, preferring to fill partial groups before new ones. */
function leastFullGroup(room) {
  let best = null;
  for (const g of room.groups) {
    const count = g.seats.filter(Boolean).length;
    if (count >= SEATS_PER_GROUP) continue;
    if (!best || count < best.count) best = { group: g, count };
  }
  return best?.group ?? null;
}

function clientToken(raw) {
  const s = String(raw || '');
  return s.length >= 8 && s.length <= 200 ? s : newToken();
}

function seatPlayer(room, group, name, token) {
  const seatIndex = group.seats.findIndex((s) => s === null);
  if (seatIndex === -1) throw new ApiError(409, '이 구역은 이미 가득 찼어요.');
  group.seats[seatIndex] = { token, name };
  if (!group.game) group.game = newGame(name, false);
  else group.game.players[seatIndex] = { name, coins: 1000, solved: Array(20).fill(0) };
  // Keep the players array aligned with seats even when an earlier seat is still empty.
  while (group.game.players.length < group.seats.filter(Boolean).length) {
    group.game.players.push({ name: '', coins: 1000, solved: Array(20).fill(0) });
  }
  tokens.set(token, { code: room.code, group: group.group, seat: seatIndex });
  return { token, seat: seatIndex };
}

function resolveToken(token) {
  const loc = token && tokens.get(token);
  if (!loc) return null;
  const room = rooms.get(loc.code);
  if (!room) { tokens.delete(token); return null; }
  const group = room.groups.find((g) => g.group === loc.group);
  if (!group || !group.seats[loc.seat] || group.seats[loc.seat].token !== token) return null;
  return { room, group, seat: loc.seat };
}

function requireRoom(code) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) throw new ApiError(404, '학급 또는 팀 코드를 찾을 수 없습니다.');
  return room;
}

/** Advance every group's simulation that is mid-round. Called on a fixed server tick. */
function tickAll() {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const g of room.groups) {
      if (!g.game) continue;
      const { phase, autoStartAt } = g.game;
      if (phase === 'wave' || phase === 'break' || (phase === 'prepare' && autoStartAt !== undefined)) {
        try { if (tick(g.game, now)) g.revision++; } catch { /* a mid-tick throw shouldn't take the room down */ }
      }
    }
  }
}
const tickTimer = setInterval(tickAll, TICK_MS);
tickTimer.unref?.();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new ApiError(413, '요청이 너무 큽니다.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseJson(req) {
  const body = await readBody(req);
  try { return JSON.parse(body.toString('utf8') || '{}'); } catch { throw new ApiError(400, '요청 형식이 올바르지 않습니다.'); }
}

function send(res, status, payload) {
  const json = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(json);
}

// --- /api/team: creating/joining a standalone team, and all in-round gameplay actions. ---

const ACTION_KINDS = new Set(['build', 'upgrade', 'enhance', 'demolish', 'move']);

/** The envelope every /api/team response shares (except 'question', which is quiz-only). */
function envelope(room, group, seat, extra) {
  return {
    code: room.code,
    seat,
    revision: group.revision,
    now: Date.now(),
    classroom: room.kind === 'classroom' ? roomSummary(room) : null,
    game: group.game,
    ...extra,
  };
}

async function handleTeam(req, res) {
  let body;
  try { body = await parseJson(req); } catch (err) { return send(res, err.status ?? 400, { error: err.message }); }
  const { action } = body;
  try {
    if (action === 'create') {
      const room = createRoom({ kind: 'team', hostToken: null });
      const seat = seatPlayer(room, room.groups[0], cleanName(body.name) || '팀장', clientToken(body.token));
      return send(res, 200, { ...envelope(room, room.groups[0], seat.seat), token: seat.token });
    }
    if (action === 'join') {
      const room = requireRoom(body.code);
      if (room.kind !== 'team') throw new ApiError(400, '팀 코드가 아닙니다.');
      touch(room);
      const seat = seatPlayer(room, room.groups[0], cleanName(body.name) || '팀원', clientToken(body.token));
      return send(res, 200, { ...envelope(room, room.groups[0], seat.seat), token: seat.token });
    }

    // Every other action needs an already-seated player.
    const loc = resolveToken(body.token);
    if (!loc) throw new ApiError(401, '세션이 만료되었어요. 다시 입장해 주세요.');
    const { room, group, seat } = loc;
    touch(room);

    if (action === 'sync' || action === 'peek') {
      return send(res, 200, envelope(room, group, seat));
    }
    if (action === 'question') {
      const level = Number(body.level);
      if (!Number.isInteger(level) || level < 0 || level > 5) throw new ApiError(400, '잘못된 문제 번호예요.');
      const seed = randomInt(2 ** 31);
      group.quizSeeds.set(`${seat}:${level}`, seed);
      const quiz = makeQuiz(seed, quizRound(group.game), seat, level);
      return send(res, 200, { quiz });
    }
    if (action === 'answer') {
      const level = Number(body.level);
      const seed = group.quizSeeds.get(`${seat}:${level}`);
      if (seed === undefined) throw new ApiError(400, '문제를 먼저 받아와 주세요.');
      const quiz = makeQuiz(seed, quizRound(group.game), seat, level);
      if (body.quizId !== undefined && body.quizId !== quiz.id) throw new ApiError(409, '문제가 바뀌었어요. 다시 골라 주세요.');
      const result = answerQuiz(group.game, seat, quiz, Number(body.choice));
      group.quizSeeds.delete(`${seat}:${level}`);
      group.revision++;
      return send(res, 200, envelope(room, group, seat, { result }));
    }
    if (action === 'start') {
      startWave(group.game, Date.now());
      group.revision++;
      return send(res, 200, envelope(room, group, seat, { result: { started: group.game.round } }));
    }
    if (action === 'restart') {
      group.game = restartGame(group.game, false);
      group.revision++;
      return send(res, 200, envelope(room, group, seat, { result: { started: group.game.round } }));
    }
    if (action === 'skip-round') {
      if (group.game.phase !== 'wave') throw new ApiError(400, '지금은 라운드를 건너뛸 수 없어요.');
      skipRound(group.game, Date.now());
      group.revision++;
      return send(res, 200, envelope(room, group, seat, { result: { skipped: true, round: group.game.round, phase: group.game.phase } }));
    }
    if (action.startsWith('upgrade-meta-')) {
      metaUpgrade(group.game, seat, action.slice('upgrade-meta-'.length));
      group.revision++;
      return send(res, 200, envelope(room, group, seat, { result: { meta: group.game.meta } }));
    }
    if (ACTION_KINDS.has(action)) {
      const point = { x: Number(body.x), y: Number(body.y) };
      const aux = action === 'demolish'
        ? { id: body.towerId ?? null, refund: Number(body.refund) }
        : action === 'move'
        ? { x: Number(body.fromX), y: Number(body.fromY) }
        : undefined;
      const i = randomInt(100);
      const tower = applyAction(group.game, seat, action, point, i, aux);
      group.revision++;
      return send(res, 200, envelope(room, group, seat, { result: { tower, action } }));
    }
    throw new ApiError(400, '알 수 없는 요청이에요.');
  } catch (err) {
    if (err instanceof ApiError) return send(res, err.status, { error: err.message });
    return send(res, 400, { error: err.message || '요청을 처리하지 못했습니다.' });
  }
}

// --- /api/classroom: the teacher-facing class roster, admission and group inspection. ---

async function handleClassroom(req, res) {
  let body;
  try { body = await parseJson(req); } catch (err) { return send(res, err.status ?? 400, { error: err.message }); }
  const { action } = body;
  try {
    if (action === 'create') {
      const token = clientToken(body.token);
      const room = createRoom({ kind: 'classroom', name: body.name, classNo: Number(body.classNo) || 0, hostToken: token });
      return send(res, 200, { ...roomSummary(room), token });
    }
    if (action === 'peek') {
      const room = requireRoom(body.code);
      return send(res, 200, roomSummary(room));
    }
    if (action === 'join') {
      const room = requireRoom(body.code);
      if (room.kind !== 'classroom') throw new ApiError(400, '학급 코드가 아닙니다.');
      if (room.closed) throw new ApiError(403, '선생님이 입장을 마감했어요.');
      touch(room);
      const group = leastFullGroup(room);
      if (!group) throw new ApiError(409, '학급 정원이 가득 찼어요.');
      const seat = seatPlayer(room, group, cleanName(body.name) || '학생', clientToken(body.token));
      return send(res, 200, { code: room.code, token: seat.token, group: group.group, seat: seat.seat, classroom: roomSummary(room) });
    }

    // sync / inspect / set-admission all need the caller's token resolved.
    if (action === 'sync') {
      const loc = resolveToken(body.token);
      if (!loc) throw new ApiError(401, '세션이 만료되었어요. 다시 입장해 주세요.');
      touch(loc.room);
      return send(res, 200, { code: loc.room.code, group: loc.group.group, seat: loc.seat, classroom: roomSummary(loc.room), game: loc.group.game });
    }

    const room = requireRoom(body.code);
    const isHost = room.hostToken && room.hostToken === body.token;
    if (!isHost) throw new ApiError(403, '선생님만 할 수 있어요.');
    touch(room);
    if (action === 'inspect') {
      const g = room.groups.find((x) => x.group === Number(body.group));
      if (!g) throw new ApiError(404, '구역을 찾을 수 없어요.');
      return send(res, 200, { game: g.game });
    }
    if (action === 'set-admission') {
      room.closed = Boolean(body.closed);
      return send(res, 200, roomSummary(room));
    }
    if (action === 'start') {
      room.closed = true;
      for (const g of room.groups) {
        if (g.game && g.game.players.length >= 2 && (g.game.phase === 'lobby' || g.game.phase === 'prepare')) {
          try { startWave(g.game, Date.now()); g.revision++; } catch { /* not enough players, or already running */ }
        }
      }
      return send(res, 200, roomSummary(room));
    }
    if (action === 'end') {
      room.ended = true;
      room.closed = true;
      return send(res, 200, roomSummary(room));
    }
    throw new ApiError(400, '알 수 없는 요청이에요.');
  } catch (err) {
    if (err instanceof ApiError) return send(res, err.status, { error: err.message });
    return send(res, 400, { error: err.message || '요청을 처리하지 못했습니다.' });
  }
}

const CLASS_NUMBERS = 12; // the join/manage screen always shows slots "1반" through "12반"

function handleClasses(req, res) {
  sweep();
  // One row per class number 1-12: the most recently active non-ended classroom using that
  // number, if any. The client (Gt in classroom-BwhO2dwR.js) reads { number, code, ended }.
  const byNumber = new Map();
  for (const room of rooms.values()) {
    if (room.kind !== 'classroom') continue;
    const prev = byNumber.get(room.classNo);
    if (!prev || room.lastActive > prev.lastActive) byNumber.set(room.classNo, room);
  }
  const classes = Array.from({ length: CLASS_NUMBERS }, (_, i) => {
    const number = i + 1;
    const room = byNumber.get(number);
    return { number, code: room && !room.ended ? room.code : null, ended: !room || room.ended };
  });
  send(res, 200, { classes });
}

function handleQr(req, res, pathname) {
  const { searchParams } = new URL(req.url, 'http://local');
  const code = String(searchParams.get('class') || '').toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) { res.writeHead(400); return res.end(); }
  const host = req.headers.host || 'localhost';
  const data = encodeURIComponent(`https://${host}/?class=${code}`);
  const upstream = `https://api.qrserver.com/v1/create-qr-code/?size=190x190&data=${data}`;
  return serveCached(req, res, upstream, `luckdefense-qr-${code}.png`, { type: 'image/png', max: 256 * 1024 });
}

/** Dispatches the four luckdefense endpoints; returns false if the path isn't one of them. */
export function handleLuckdefense(req, res, pathname) {
  if (pathname === '/api/team' && req.method === 'POST') { handleTeam(req, res); return true; }
  if (pathname === '/api/classroom' && req.method === 'POST') { handleClassroom(req, res); return true; }
  if (pathname === '/api/classes' && req.method === 'GET') { handleClasses(req, res); return true; }
  if (pathname === '/api/qr' && req.method === 'GET') { handleQr(req, res, pathname); return true; }
  return false;
}
