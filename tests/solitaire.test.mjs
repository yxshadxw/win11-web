import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { canTableau, canFoundation, isWon, newGame, move, draw } from '../public/apps/solitaire/rules.js';

const card = (suit, rank, faceUp = true) => ({ suit, rank, faceUp });

test('tableau requires alternating colors descending and kings in empty columns', () => {
  assert.equal(canTableau(card('hearts', 6), card('clubs', 7)), true);
  assert.equal(canTableau(card('diamonds', 6), card('hearts', 7)), false);
  assert.equal(canTableau(card('clubs', 12), null), false);
  assert.equal(canTableau(card('clubs', 13), null), true);
});

test('foundation builds from ace in the same suit', () => {
  assert.equal(canFoundation(card('spades', 1), null), true);
  assert.equal(canFoundation(card('spades', 2), card('spades', 1)), true);
  assert.equal(canFoundation(card('hearts', 2), card('spades', 1)), false);
});

test('win requires all 52 cards in foundations', () => {
  assert.equal(isWon({ foundations: [13, 13, 13, 13].map(n => Array(n)) }), true);
  assert.equal(isWon({ foundations: [13, 13, 13, 12].map(n => Array(n)) }), false);
});

test('deal, draw and legal moves preserve cards and reveal tableau', () => {
  const game = newGame(() => 0.5);
  assert.equal(game.stock.length, 24);
  assert.equal(game.tableau.flat().filter(c => c.faceUp).length, 7);
  draw(game, 3);
  assert.equal(game.waste.length, 3);
  const custom = { tableau: [[card('clubs', 8, false), card('hearts', 7)], [card('clubs', 8)], [], [], [], [], []], foundations: [[], [], [], []], waste: [], stock: [] };
  assert.equal(move(custom, { type: 'tableau', index: 0, card: 1 }, { type: 'tableau', index: 1 }), true);
  assert.equal(custom.tableau[0][0].faceUp, true);
});
