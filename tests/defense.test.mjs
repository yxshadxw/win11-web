import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseTarget, damageEnemy, wavePlan } from '../public/apps/defense/rules.js';

test('target modes and flying restrictions select eligible enemies', () => {
  const enemies = [{ progress: 4, hp: 10, x: 1, y: 0 }, { progress: 8, hp: 20, x: 2, y: 0 }, { progress: 12, hp: 30, x: 1, y: 0, flying: true }];
  const tower = { x: 0, y: 0, range: 3, antiAir: false };
  assert.equal(chooseTarget(tower, enemies, 'first'), enemies[1]);
  assert.equal(chooseTarget(tower, enemies, 'last'), enemies[0]);
  assert.equal(chooseTarget(tower, enemies, 'strongest'), enemies[1]);
  assert.equal(chooseTarget(tower, enemies, 'closest'), enemies[0]);
});

test('armor reduces damage with a minimum hit and piercing bypasses it', () => {
  assert.equal(damageEnemy({ hp: 20, armor: 5 }, 8), 17);
  assert.equal(damageEnemy({ hp: 20, armor: 50 }, 8), 19);
  assert.equal(damageEnemy({ hp: 20, armor: 5 }, 8, true), 12);
});

test('waves are deterministic, scheduled, and introduce bosses', () => {
  const plan = wavePlan(20);
  assert.ok(plan.some(item => item.type === 'boss'));
  assert.ok(plan.every((item, i) => i === 0 || item.time >= plan[i - 1].time));
  assert.deepEqual(wavePlan(7), wavePlan(7));
});
