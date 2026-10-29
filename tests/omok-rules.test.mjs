import test from 'node:test';
import assert from 'node:assert/strict';
import { winner, chooseMove } from '../public/apps/omok/rules.js';

test('six stones also win', () => {
  const board = Array(225).fill(0);
  for (let x = 0; x < 6; x++) board[7 * 15 + x] = 1;
  assert.equal(winner(board, 7 * 15 + 5).line.length, 6);
});
test('hard AI blocks an immediate win', () => {
  const board = Array(225).fill(0);
  for (let x = 4; x < 8; x++) board[7 * 15 + x] = 1;
  assert.ok([7 * 15 + 3, 7 * 15 + 8].includes(chooseMove(board, 2, 3)));
});
