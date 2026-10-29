import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, generate } from '../public/apps/sudoku/rules.js';

test('solver finds the unique solution and rejects contradictions', () => {
  const puzzle = '530070000600195000098000060800060003400803001700020006060000280000419005000080079'.split('').map(Number);
  const result = solve(puzzle);
  assert.equal(result.count, 1);
  assert.equal(result.solution.join(''), '534678912672195348198342567859761423426853791713924856961537284287419635345286179');
  puzzle[1] = 5;
  assert.equal(solve(puzzle).count, 0);
});

test('generated puzzles have one solution at every difficulty', () => {
  for (const difficulty of ['easy', 'medium', 'hard', 'expert']) {
    const { puzzle, solution } = generate(difficulty);
    const solved = solve(puzzle);
    assert.equal(solved.count, 1);
    assert.deepEqual(solved.solution, solution);
  }
});
