import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, blastTiles, passable, W, H, FLOOR, BOX, WALL, FUSE, TRAP, SPAWNS, SPIRAL } from '../public/apps/balloon/rules.js';
import { createBrain, botInput, dangerMap } from '../public/apps/balloon/ai.js';

const at = (g, x, y) => y * W + x;
/** An arena with no boxes, so tests control every tile. */
function open(players = 2) {
  const g = createGame({ players, seed: 7 });
  g.tiles = g.tiles.map((t) => (t === BOX ? FLOOR : t));
  g.hidden = g.hidden.map(() => null);
  return g;
}
const run = (g, seconds, inputs = []) => { for (let t = 0; t < seconds; t += 0.05) step(g, 0.05, inputs); };

test('maps are seeded, framed by walls, and spawn corners are clear', () => {
  const a = createGame({ seed: 42 });
  const b = createGame({ seed: 42 });
  assert.deepEqual(a.tiles, b.tiles);
  assert.notDeepEqual(a.tiles, createGame({ seed: 43 }).tiles);
  for (let x = 0; x < W; x++) assert.equal(a.tiles[at(a, x, 0)], WALL);
  for (const [x, y] of SPAWNS) {
    assert.equal(a.tiles[at(a, x, y)], FLOOR);
    assert.ok(passable(a, x + (x === 1 ? 1 : -1), y) || passable(a, x, y + (y === 1 ? 1 : -1)));
  }
  assert.equal(SPIRAL.length, (W - 2) * (H - 2));
});

test('players walk corridors and stop at walls', () => {
  const g = open();
  run(g, 1, [{ dir: 'up' }]);
  assert.equal(g.players[0].y, 1); // wall above the spawn
  run(g, 0.3, [{ dir: 'right' }]);
  assert.ok(g.players[0].x > 1.5);
  assert.equal(g.players[0].y, 1);
});

test('balloons block movement except for the one you stand on', () => {
  const g = open();
  step(g, 0.01, [{ place: true }]);
  assert.equal(g.balloons.length, 1);
  step(g, 0.01, [{ place: true }]);
  assert.equal(g.balloons.length, 1, 'one balloon to start with');
  run(g, 0.5, [{ dir: 'right' }]);
  assert.ok(g.players[0].x > 2, 'walked off the balloon');
  run(g, 0.5, [{ dir: 'left' }]);
  assert.equal(g.players[0].x, 2, 'cannot walk back onto it');
});

test('a blast stops at walls, soaks the first box, and chains other balloons', () => {
  const g = open();
  g.tiles[at(g, 5, 1)] = BOX;
  g.hidden[at(g, 5, 1)] = 'range';
  assert.deepEqual(blastTiles(g, 3, 1, 3).map(String).sort(), ['1,1', '2,1', '3,1', '3,2', '3,3', '3,4', '4,1', '5,1'].sort());
  g.balloons.push({ x: 3, y: 1, timer: 0.01, range: 2, owner: 1 }, { x: 3, y: 3, timer: 99, range: 2, owner: 1 });
  g.players[0].x = 9; g.players[0].y = 9;
  step(g, 0.05);
  assert.equal(g.balloons.length, 0, 'chain reaction popped both');
  assert.equal(g.tiles[at(g, 5, 1)], FLOOR);
  assert.equal(g.items[at(g, 5, 1)], 'range', 'the box dropped its item');
});

test('soaked players get trapped, then pop by timeout or a rival touch', () => {
  const g = open(3);
  g.balloons.push({ x: 1, y: 1, timer: 0.01, range: 2, owner: 1 });
  step(g, 0.05);
  assert.ok(g.players[0].trapped > 0);
  run(g, TRAP + 0.1);
  assert.equal(g.players[0].alive, false);

  const h = open(3);
  h.balloons.push({ x: 1, y: 1, timer: 0.01, range: 1, owner: 1 });
  run(h, 0.6); // let the water drain first, or the rescuer gets trapped too
  assert.equal(h.players[0].alive, true);
  Object.assign(h.players[1], { x: 1.5, y: 1 });
  step(h, 0.05);
  assert.equal(h.players[0].alive, false);
  assert.equal(h.players[1].pops, 1);
});

test('the last player standing wins; items raise stats', () => {
  const g = open(2);
  g.items[at(g, 2, 1)] = 'count';
  run(g, 0.5, [{ dir: 'right' }]);
  assert.equal(g.players[0].count, 2);
  g.balloons.push({ x: g.players[1].x, y: g.players[1].y, timer: 0.01, range: 1, owner: 0 });
  run(g, TRAP + 0.5);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 0);
});

test('sudden death closes the arena so every round ends', () => {
  const g = open(2);
  run(g, g.limit + 1);
  assert.equal(g.phase, 'over');
  assert.ok(g.closed > 0);
});

test('bots flee their own balloons and finish rounds', () => {
  const g = open(2);
  const brain = createBrain('hard');
  g.balloons.push({ x: 1, y: 1, timer: FUSE, range: 2, owner: 0 });
  assert.ok(dangerMap(g).has(at(g, 1, 1)));
  for (let i = 0; i < 40; i++) step(g, 0.05, [botInput(g, 0, brain, 0.05, () => 0.5)]);
  assert.ok(g.players[0].alive && !g.players[0].trapped, 'escaped the blast');
  let r = 1;
  const rand = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const round = createGame({ seed: 3 });
  const brains = round.players.map(() => createBrain('normal'));
  while (round.phase === 'playing') step(round, 0.05, round.players.map((_, i) => botInput(round, i, brains[i], 0.05, rand)));
  assert.equal(round.phase, 'over');
});
