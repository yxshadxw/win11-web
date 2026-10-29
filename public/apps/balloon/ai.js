// Computer players. Pure functions of the game state, so the server can drive bots (and
// players who dropped their connection) with exactly the logic the browser uses offline.
import { W, BOX, DIRECTIONS, SPIRAL, SUDDEN, blastTiles, cellOf, passable, tileAt, balloonAt } from './rules.js';

const key = (x, y) => y * W + x;

/** Seconds until each tile gets soaked (0 = soaked right now). Chains take the earliest fuse. */
export function dangerMap(game, extra) {
  const danger = new Map();
  for (const s of game.bursts) danger.set(key(s.x, s.y), 0);
  const balloons = extra ? [...game.balloons, extra] : game.balloons;
  const fuse = new Map(balloons.map((b) => [b, b.timer]));
  // Relax a few times so a short fuse sets off everything it reaches.
  for (let pass = 0; pass < 4; pass++) {
    for (const b of balloons) {
      for (const [x, y] of blastTiles(game, b.x, b.y, b.range)) {
        const other = balloons.find((o) => o.x === x && o.y === y);
        if (other && fuse.get(other) > fuse.get(b)) fuse.set(other, fuse.get(b));
      }
    }
  }
  for (const b of balloons) {
    for (const [x, y] of blastTiles(game, b.x, b.y, b.range)) {
      const k = key(x, y);
      danger.set(k, Math.min(danger.get(k) ?? Infinity, fuse.get(b)));
    }
  }
  // Sudden death: treat tiles about to turn into wall like water.
  const start = game.limit - SUDDEN;
  for (let j = game.closed || 0; j < SPIRAL.length; j++) {
    const left = start + (j * SUDDEN) / SPIRAL.length - game.time;
    if (left > 4) break;
    const k = key(...SPIRAL[j]);
    danger.set(k, Math.min(danger.get(k) ?? Infinity, Math.max(0, left)));
  }
  return danger;
}

/** Breadth-first walk from `start`; returns { dist, first } maps keyed by tile. */
function explore(game, start, danger, speed) {
  const dist = new Map([[key(...start), 0]]);
  const first = new Map();
  const queue = [start];
  while (queue.length) {
    const [x, y] = queue.shift();
    const d = dist.get(key(x, y));
    for (const [name, [dx, dy]] of Object.entries(DIRECTIONS)) {
      const nx = x + dx;
      const ny = y + dy;
      const k = key(nx, ny);
      if (dist.has(k) || !passable(game, nx, ny, d === 0 ? start : null)) continue;
      // Never walk into water, or onto a tile that soaks before we would be off it again.
      const t = danger.get(k);
      if (t !== undefined && t < (d + 2) / speed) continue;
      dist.set(k, d + 1);
      first.set(k, d === 0 ? name : first.get(key(x, y)));
      queue.push([nx, ny]);
    }
  }
  return { dist, first };
}

function nearest(map, test) {
  let best = null;
  for (const [k, d] of map.dist) if (test(k) && (!best || d < best.d)) best = { k, d };
  return best;
}

/** Would a balloon dropped here hit a box or a rival? */
function worthDropping(game, i, x, y) {
  const me = game.players[i];
  for (const [tx, ty] of blastTiles(game, x, y, me.range)) {
    if (tileAt(game, tx, ty) === BOX) return true;
    if (game.players.some((p, j) => j !== i && p.alive && !p.trapped && cellOf(p)[0] === tx && cellOf(p)[1] === ty)) return true;
  }
  return false;
}

export function createBrain(level = 'normal') {
  return { dir: null, target: null, wait: 0, level };
}

const LEVEL = { easy: { think: 0.35, aggression: 0.35 }, normal: { think: 0.15, aggression: 0.7 }, hard: { think: 0.05, aggression: 1 } };

/** Decide this tick's input for player i. `brain` keeps the bot's plan between ticks. */
export function botInput(game, i, brain, dt, random = Math.random) {
  const me = game.players[i];
  if (!me.alive || game.phase !== 'playing') return { dir: null, place: false };
  const level = LEVEL[brain.level] || LEVEL.normal;
  // Keep walking to the tile we chose; plan again once we are close to its center.
  if (brain.target) {
    const [tx, ty] = brain.target;
    const far = Math.abs(me.x - tx) + Math.abs(me.y - ty);
    if (far > 0.18 && passable(game, tx, ty, cellOf(me))) return { dir: brain.dir, place: false };
    brain.target = null;
  }
  brain.wait -= dt;
  const here = cellOf(me);
  const danger = dangerMap(game);
  const inDanger = danger.has(key(...here));
  if (!inDanger && brain.wait > 0) return { dir: null, place: false };
  brain.wait = level.think * (0.5 + random());

  const go = (dir) => {
    if (!dir) { brain.dir = null; return { dir: null, place: false }; }
    const [dx, dy] = DIRECTIONS[dir];
    brain.dir = dir;
    brain.target = [here[0] + dx, here[1] + dy];
    return { dir, place: false };
  };

  const map = explore(game, here, danger, me.trapped ? 0.6 : me.speed);
  if (inDanger) {
    const safe = nearest(map, (k) => !danger.has(k));
    return go(safe ? map.first.get(safe.k) : null);
  }
  if (me.trapped) return go(null);

  // Drop a balloon when it does something and there is still a way out afterwards.
  const mine = game.balloons.filter((b) => b.owner === i).length;
  if (mine < me.count && !balloonAt(game, ...here) && random() < level.aggression && worthDropping(game, i, ...here)) {
    const plan = { x: here[0], y: here[1], timer: 2.6, range: me.range, owner: i };
    const after = dangerMap(game, plan);
    const escape = explore({ ...game, balloons: [...game.balloons, plan] }, here, after, me.speed);
    if (nearest(escape, (k) => !after.has(k))) return { dir: null, place: true };
  }

  const tile = (k) => [k % W, Math.floor(k / W)];
  const rival = (k) => game.players.some((p, j) => j !== i && p.alive && key(...cellOf(p)) === k);
  const goals = [
    (k) => game.players.some((p, j) => j !== i && p.alive && p.trapped && key(...cellOf(p)) === k), // finish a trapped rival
    (k) => Boolean(game.items[k]),
    (k) => worthDropping(game, i, ...tile(k)) && (random() < 0.9 || rival(k)),
  ];
  for (const goal of goals) {
    const found = nearest(map, (k) => k !== key(...here) && !danger.has(k) && goal(k));
    if (found) return go(map.first.get(found.k));
  }
  const options = Object.keys(DIRECTIONS).filter((d) => {
    const [dx, dy] = DIRECTIONS[d];
    const k = key(here[0] + dx, here[1] + dy);
    return map.dist.has(k) && !danger.has(k);
  });
  return go(options.length ? options[Math.floor(random() * options.length)] : null);
}
