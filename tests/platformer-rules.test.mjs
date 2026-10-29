import test from 'node:test';
import assert from 'node:assert/strict';
import { levels } from '../public/apps/platformer/levels.js';
import { resolveAxis } from '../public/apps/platformer/rules.js';

test('eight rectangular levels have exactly one start and goal', () => {
  assert.equal(levels.length, 8);
  for (const level of levels) {
    assert.ok(level.every(row => row.length === level[0].length));
    assert.equal(level.join('').split('S').length - 1, 1);
    assert.equal(level.join('').split('G').length - 1, 1);
  }
});

test('axis collision stops at a solid tile edge', () => {
  const body = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(resolveAxis(body, 20, 'x', [{ x: 15, y: 0, w: 10, h: 10 }]), 5);
  assert.equal(resolveAxis(body, 20, 'y', [{ x: 0, y: 15, w: 10, h: 10 }]), 5);
  assert.equal(resolveAxis(body, -20, 'x', [{ x: -15, y: 0, w: 10, h: 10 }]), -5);
});
