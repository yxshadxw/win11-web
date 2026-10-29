import test from 'node:test';
import assert from 'node:assert/strict';
import { collide, stepPuck } from '../public/apps/airhockey/rules.js';

test('moving mallet transfers velocity to puck', () => {
  const puck = { x: 100, y: 100, vx: 0, vy: 0, r: 10 };
  assert.equal(collide(puck, { x: 80, y: 100, vx: 300, vy: 0, r: 12 }), true);
  assert.ok(puck.vx > 0);
});

test('puck bounces off walls and detects goals', () => {
  const puck = { x: 11, y: 100, vx: -100, vy: 0, r: 10 };
  assert.equal(stepPuck(puck, 0.1), null);
  assert.ok(puck.vx > 0);
  Object.assign(puck, { x: 200, y: 5, vx: 0, vy: -100 });
  assert.equal(stepPuck(puck, 0.1), 'bottom');
});
