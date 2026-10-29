import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, startRound, configure, setInput, leaveRoom, roomView, frame, tick, BalloonError, _rooms } from '../balloon-online.mjs';

const stop = (code) => clearInterval(_rooms().get(code).loop);

test('seats fill up to four, then visitors spectate', () => {
  const host = createRoom({ name: '방장' });
  assert.equal(host.seat, 0);
  assert.match(host.code, /^[A-HJ-NP-Z2-9]{6}$/);
  const seats = [1, 2, 3].map((n) => joinRoom(host.code.toLowerCase(), null, `p${n}`));
  assert.deepEqual(seats.map((s) => s.seat), [1, 2, 3]);
  assert.equal(joinRoom(host.code, null, 'late').seat, -1);
  assert.equal(joinRoom(host.code, seats[1].token).seat, 2, 'rejoining keeps your seat');
  const view = roomView(_rooms().get(host.code));
  assert.deepEqual(view.seats.map((s) => s.name), ['방장', 'p1', 'p2', 'p3']);
  assert.ok(!JSON.stringify(view).includes(host.token));
});

test('only the host starts, and needs two players (bots count)', () => {
  const host = createRoom({ name: 'a' });
  const guest = joinRoom(host.code, null, 'b');
  assert.throws(() => startRound(host.code, guest.token), (e) => e instanceof BalloonError && e.status === 403);
  leaveRoom(host.code, guest.token);
  assert.throws(() => startRound(host.code, host.token, { bots: 0 }), /두 명 이상/);
  configure(host.code, host.token, { bots: 2, layout: 'garden' });
  startRound(host.code, host.token);
  stop(host.code);
  const room = _rooms().get(host.code);
  assert.equal(room.game.players.length, 3);
  assert.equal(room.game.layout, 'garden');
  assert.deepEqual(room.game.players.map((p) => p.bot), [false, true, true]);
  assert.throws(() => startRound(host.code, host.token), /진행 중/);
});

test('inputs drive the server simulation and frames stay compact', () => {
  const host = createRoom({ name: 'a' });
  const guest = joinRoom(host.code, null, 'b');
  startRound(host.code, host.token);
  stop(host.code);
  const room = _rooms().get(host.code);
  // Pretend both players are connected so the bots do not take over.
  room.clients = new Set([{ seat: 0, res: { write() {} } }, { seat: 1, res: { write() {} } }]);
  setInput(host.code, host.token, { dir: 'down', place: true });
  tick(room);
  assert.equal(room.game.balloons.length, 1);
  assert.equal(room.seats[0].input.place, false, 'a press is used once');
  for (let i = 0; i < 6; i++) tick(room);
  assert.ok(room.game.players[0].y > 1);
  assert.throws(() => setInput(host.code, 'nope', { dir: 'up' }), /플레이어가 아닙니다/);
  const full = frame(room, true);
  assert.equal(full.tiles.length, 15 * 13);
  room.sentMap = room.game.mapVersion;
  assert.equal(frame(room).tiles, undefined, 'unchanged map is not resent');
  assert.ok(!JSON.stringify(full).includes(guest.token));
});

test('input flooding is refused per seat', () => {
  const host = createRoom({ name: 'a' });
  let refused = 0;
  for (let i = 0; i < 60; i++) {
    try { setInput(host.code, host.token, { dir: 'up' }); } catch (e) { if (e.status === 429) refused++; }
  }
  assert.ok(refused >= 15);
});

test('a player who leaves mid-round is played by a bot, and the seat frees afterwards', () => {
  const host = createRoom({ name: 'a' });
  const guest = joinRoom(host.code, null, 'b');
  startRound(host.code, host.token, { bots: 1 });
  stop(host.code);
  const room = _rooms().get(host.code);
  leaveRoom(host.code, host.token);
  assert.equal(room.seats.length, 2, 'seat kept while playing');
  assert.equal(room.host, guest.token, 'host passes on');
  while (room.game.phase === 'playing') tick(room);
  assert.equal(room.phase, 'over');
  assert.equal(joinRoom(host.code, null, 'c').seat, 1, 'the empty seat is reused');
  assert.equal(room.seats[0].name, 'b');
});
