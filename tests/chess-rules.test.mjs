import test from 'node:test';
import assert from 'node:assert/strict';
import { initial, fromFEN, legalMoves, play, status } from '../public/apps/chess/rules.js';

function perft(state, depth) {
  if (!depth) return 1;
  return legalMoves(state).reduce((sum, move) => sum + perft(play(state, move), depth - 1), 0);
}
test('start position perft depth three', () => assert.equal(perft(initial(), 3), 8902));
test('castling, en passant and promotion', () => {
  assert.ok(legalMoves(fromFEN('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')).some(m => m.castle === 'K'));
  assert.ok(legalMoves(fromFEN('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1')).some(m => m.ep));
  assert.equal(legalMoves(fromFEN('4k3/P7/8/8/8/8/8/4K3 w - - 0 1')).filter(m => m.from === 8 && m.to === 0).length, 4);
});
test('checkmate', () => assert.equal(status(fromFEN('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1')).kind, 'checkmate'));
test('castling through check and pinned en passant are illegal', () => {
  assert.ok(!legalMoves(fromFEN('4kr2/8/8/8/8/8/8/4K2R w K - 0 1')).some(m => m.castle));
  assert.ok(!legalMoves(fromFEN('k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1')).some(m => m.ep));
});
test('draw conditions', () => {
  assert.equal(status(fromFEN('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).kind, 'stalemate');
  assert.equal(status(fromFEN('4k3/8/8/8/8/8/8/R3K3 w - - 100 1')).kind, 'fifty');
  assert.equal(status(fromFEN('4k3/8/8/8/8/8/8/4K3 w - - 0 1')).kind, 'material');
  let s = initial();
  for (const [from, to] of [[62,45],[6,21],[45,62],[21,6],[62,45],[6,21],[45,62],[21,6]]) s = play(s, legalMoves(s).find(m => m.from === from && m.to === to));
  assert.equal(status(s).kind, 'repetition');
});
