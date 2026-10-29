import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, makeMove, resign, requestRematch, snapshot, ChessError, _rooms } from '../chess-online.mjs';

const sq = (name) => (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0]);

test('creator is white, second player black, third is a spectator', () => {
  const w = createRoom();
  assert.equal(w.color, 'w');
  assert.match(w.code, /^[A-HJ-NP-Z2-9]{6}$/);
  const b = joinRoom(w.code.toLowerCase());
  assert.equal(b.color, 'b');
  assert.equal(joinRoom(w.code).color, 'spectator');
  // Rejoining with your token keeps your seat.
  assert.equal(joinRoom(w.code, b.token).color, 'b');
});

test('server enforces turns, seats, and legality', () => {
  const w = createRoom();
  assert.throws(() => makeMove(w.code, w.token, { from: sq('e2'), to: sq('e4') }), (e) => e instanceof ChessError && e.status === 409);
  const b = joinRoom(w.code);
  assert.throws(() => makeMove(w.code, b.token, { from: sq('e7'), to: sq('e5') }), /상대 차례/);
  assert.throws(() => makeMove(w.code, 'stolen', { from: sq('e2'), to: sq('e4') }), /플레이어가 아닙니다/);
  assert.throws(() => makeMove(w.code, w.token, { from: sq('e2'), to: sq('e5') }), /둘 수 없는 수/);
  const s = makeMove(w.code, w.token, { from: sq('e2'), to: sq('e4') });
  assert.deepEqual(s.notes, ['e4']);
  assert.equal(s.turn, 'b');
});

test("fool's mate ends the game; rematch swaps colors after both ask", () => {
  const w = createRoom();
  const b = joinRoom(w.code);
  makeMove(w.code, w.token, { from: sq('f2'), to: sq('f3') });
  makeMove(w.code, b.token, { from: sq('e7'), to: sq('e5') });
  makeMove(w.code, w.token, { from: sq('g2'), to: sq('g4') });
  const end = makeMove(w.code, b.token, { from: sq('d8'), to: sq('h4') });
  assert.equal(end.status, 'checkmate');
  assert.deepEqual(end.notes.at(-1), 'Qh4#');
  assert.throws(() => makeMove(w.code, w.token, { from: sq('a2'), to: sq('a3') }), /끝난 대국/);
  requestRematch(w.code, w.token);
  assert.equal(snapshot(_rooms().get(w.code)).moves.length, 4); // waiting for the other player
  requestRematch(w.code, b.token);
  const room = _rooms().get(w.code);
  assert.equal(room.tokens.w, b.token);
  assert.equal(room.tokens.b, w.token);
  assert.equal(snapshot(room).moves.length, 0);
});

test('resigning ends the game and snapshots never leak tokens', () => {
  const w = createRoom();
  joinRoom(w.code);
  resign(w.code, w.token);
  const s = snapshot(_rooms().get(w.code));
  assert.equal(s.status, 'resign-w');
  assert.ok(!JSON.stringify(s).includes(w.token));
});
