// Water-balloon arena rules. Pure and deterministic (seeded), so the browser runs it for
// solo play and the server runs the very same code as the referee for online rooms.
export const W = 15;
export const H = 13;
export const FLOOR = '.';
export const WALL = '#';
export const BOX = 'b';
export const ITEMS = ['count', 'range', 'speed'];
export const FUSE = 2.6;
export const BURST = 0.45;
export const TRAP = 3;
export const TIME_LIMIT = 180;
export const SUDDEN = 60; // the last minute: walls close in from the edge
export const SPAWNS = [[1, 1], [W - 2, H - 2], [W - 2, 1], [1, H - 2]];
export const COLORS = ['#4fc3f7', '#ff7a7a', '#ffd166', '#b392f0'];
export const LAYOUTS = { pillars: '기둥 마을', garden: '꽃밭 광장' };
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const SPEED = { base: 3.2, step: 0.45, max: 5.9 };
const LIMIT = { count: 8, range: 8 };

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const index = (x, y) => y * W + x;

/** Interior tiles in a clockwise spiral from the outer edge to the middle. */
export const SPIRAL = (() => {
  const out = [];
  let [left, top, right, bottom] = [1, 1, W - 2, H - 2];
  while (left <= right && top <= bottom) {
    for (let x = left; x <= right; x++) out.push([x, top]);
    for (let y = top + 1; y <= bottom; y++) out.push([right, y]);
    if (top < bottom) for (let x = right - 1; x >= left; x--) out.push([x, bottom]);
    if (left < right) for (let y = bottom - 1; y > top; y--) out.push([left, y]);
    left++; top++; right--; bottom--;
  }
  return out;
})();
const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

function wallAt(layout, x, y) {
  if (x === 0 || y === 0 || x === W - 1 || y === H - 1) return true;
  if (layout === 'garden') {
    // Four planters around an open square in the middle.
    const planter = (x === 3 || x === W - 4) && (y === 3 || y === H - 4);
    const ring = (x === 6 || x === 8) && (y === 5 || y === 7);
    return planter || ring;
  }
  return x % 2 === 0 && y % 2 === 0;
}

/** Spawn corners stay clear so nobody starts boxed in. */
function nearSpawn(x, y) {
  return SPAWNS.some(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) <= 1);
}

export function createGame({ players = 4, names = [], bots = [], layout = 'pillars', seed = 1 } = {}) {
  const random = rng(seed);
  const tiles = [];
  const hidden = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let tile = FLOOR;
      if (wallAt(layout, x, y)) tile = WALL;
      else if (!nearSpawn(x, y) && random() < (layout === 'garden' ? 0.62 : 0.72)) tile = BOX;
      tiles.push(tile);
      // What a box drops is decided up front so replays and the server agree.
      hidden.push(tile === BOX && random() < 0.42 ? ITEMS[Math.floor(random() * ITEMS.length)] : null);
    }
  }
  const count = Math.max(2, Math.min(4, players));
  return {
    layout, seed: random() * 2 ** 32 >>> 0,
    tiles, hidden, items: tiles.map(() => null), mapVersion: 1,
    players: Array.from({ length: count }, (_, i) => ({
      name: names[i] || `${i + 1}P`, color: COLORS[i], bot: Boolean(bots[i]),
      x: SPAWNS[i][0], y: SPAWNS[i][1], dir: 'down', moving: false,
      alive: true, trapped: 0, count: 1, range: 2, speed: SPEED.base, pops: 0,
    })),
    balloons: [], bursts: [], closed: 0, time: 0, limit: TIME_LIMIT, phase: 'playing', winner: null, events: [],
  };
}

export const tileAt = (game, x, y) => (inside(x, y) ? game.tiles[index(x, y)] : WALL);
export const balloonAt = (game, x, y) => game.balloons.find((b) => b.x === x && b.y === y);
export const cellOf = (p) => [Math.round(p.x), Math.round(p.y)];

/** A player may step off the balloon they stand on, but never onto one. */
export function passable(game, x, y, from) {
  if (tileAt(game, x, y) !== FLOOR) return false;
  if (!balloonAt(game, x, y)) return true;
  return Boolean(from) && from[0] === x && from[1] === y;
}

function move(game, p, dir, dt) {
  const [dx, dy] = DIRS[dir];
  let dist = (p.trapped ? 0.6 : p.speed) * dt;
  const here = cellOf(p);
  const along = dx ? 'x' : 'y';
  const across = dx ? 'y' : 'x';
  const lane = dx ? here[1] : here[0];
  // Corner assist: slide onto the lane first, so turning into a corridor is forgiving.
  const off = p[across] - lane;
  if (Math.abs(off) > 1e-6) {
    const ahead = dx ? [here[0] + dx, lane] : [lane, here[1] + dy];
    if (!passable(game, ahead[0], ahead[1], here)) return;
    const slide = Math.min(Math.abs(off), dist);
    p[across] -= Math.sign(off) * slide;
    dist -= slide;
    if (dist <= 0) return;
  }
  const d = dx || dy;
  const center = dx ? here[0] : here[1];
  const next = dx ? [here[0] + dx, here[1]] : [here[0], here[1] + dy];
  if (passable(game, next[0], next[1], here)) {
    p[along] += d * dist;
  } else if ((p[along] - center) * d < 0) {
    // Blocked ahead: walk up to the middle of this tile and stop there.
    p[along] = d > 0 ? Math.min(center, p[along] + dist) : Math.max(center, p[along] - dist);
  }
}

function place(game, i) {
  const p = game.players[i];
  const [x, y] = cellOf(p);
  const mine = game.balloons.filter((b) => b.owner === i).length;
  if (mine >= p.count || balloonAt(game, x, y) || tileAt(game, x, y) !== FLOOR) return;
  game.balloons.push({ x, y, timer: FUSE, range: p.range, owner: i });
  game.events.push({ type: 'place', x, y });
}

/** Tiles a balloon at (x, y) would soak, stopping at walls and boxes (boxes still get hit). */
export function blastTiles(game, x, y, range) {
  const out = [[x, y]];
  for (const [dx, dy] of Object.values(DIRS)) {
    for (let r = 1; r <= range; r++) {
      const tx = x + dx * r;
      const ty = y + dy * r;
      const tile = tileAt(game, tx, ty);
      if (tile === WALL) break;
      out.push([tx, ty]);
      if (tile === BOX) break;
    }
  }
  return out;
}

function explode(game) {
  const queue = game.balloons.filter((b) => b.timer <= 0);
  if (!queue.length) return;
  const popped = new Set();
  const wet = new Map();
  while (queue.length) {
    const b = queue.shift();
    if (popped.has(b)) continue;
    popped.add(b);
    for (const [x, y] of blastTiles(game, b.x, b.y, b.range)) {
      wet.set(index(x, y), [x, y]);
      const other = balloonAt(game, x, y);
      if (other && !popped.has(other)) queue.push(other); // chain reaction
    }
  }
  game.balloons = game.balloons.filter((b) => !popped.has(b));
  game.events.push({ type: 'pop', count: popped.size });
  let changed = false;
  for (const [k, [x, y]] of wet) {
    if (game.tiles[k] === BOX) {
      game.tiles[k] = FLOOR;
      game.items[k] = game.hidden[k];
      game.hidden[k] = null;
      changed = true;
    } else if (game.items[k]) {
      game.items[k] = null; // items lying in the open get washed away
      changed = true;
    }
    const existing = game.bursts.find((s) => s.x === x && s.y === y);
    if (existing) existing.t = BURST;
    else game.bursts.push({ x, y, t: BURST });
  }
  if (changed) game.mapVersion++;
}

/** During sudden death each spiral tile turns into wall; whoever stands there is out. */
function closeIn(game) {
  const start = game.limit - SUDDEN;
  if (game.time < start) return;
  const due = Math.min(SPIRAL.length, Math.floor((game.time - start) / SUDDEN * SPIRAL.length) + 1);
  while (game.closed < due) {
    const [x, y] = SPIRAL[game.closed++];
    const k = index(x, y);
    if (game.tiles[k] === WALL) continue;
    game.tiles[k] = WALL;
    game.items[k] = null;
    game.hidden[k] = null;
    game.balloons = game.balloons.filter((b) => b.x !== x || b.y !== y);
    game.mapVersion++;
    game.events.push({ type: 'wall', x, y });
    game.players.forEach((p, i) => {
      if (p.alive && cellOf(p)[0] === x && cellOf(p)[1] === y) {
        p.alive = false;
        p.trapped = 0;
        game.events.push({ type: 'out', player: i, by: -1 });
      }
    });
  }
}

/** Number of players still in the round (trapped players can still be saved). */
export const standing = (game) => game.players.filter((p) => p.alive).length;

/**
 * Advance the round. inputs[i] = { dir: 'up'|'down'|'left'|'right'|null, place: boolean }.
 * game.events collects what happened this step (for sounds); callers clear it.
 */
export function step(game, dt, inputs = []) {
  if (game.phase !== 'playing') return game;
  game.time += dt;
  game.players.forEach((p, i) => {
    if (!p.alive) return;
    const input = inputs[i] || {};
    p.moving = Boolean(input.dir && DIRS[input.dir]);
    if (p.moving) {
      p.dir = input.dir;
      move(game, p, input.dir, dt);
    }
    if (input.place && !p.trapped) place(game, i);
  });
  for (const b of game.balloons) b.timer -= dt;
  for (const s of game.bursts) s.t -= dt;
  game.bursts = game.bursts.filter((s) => s.t > 0);
  explode(game);

  closeIn(game);

  const soaked = new Set(game.bursts.map((s) => index(s.x, s.y)));
  game.players.forEach((p, i) => {
    if (!p.alive) return;
    const [x, y] = cellOf(p);
    if (p.trapped) {
      p.trapped -= dt;
      // Touching a trapped rival pops their bubble.
      const popper = game.players.findIndex((q, j) => j !== i && q.alive && !q.trapped && Math.hypot(q.x - p.x, q.y - p.y) < 0.75);
      if (popper >= 0 || p.trapped <= 0) {
        p.alive = false;
        p.trapped = 0;
        if (popper >= 0) game.players[popper].pops++;
        game.events.push({ type: 'out', player: i, by: popper });
      }
    } else if (soaked.has(index(x, y))) {
      p.trapped = TRAP;
      p.moving = false;
      game.events.push({ type: 'trap', player: i });
    } else {
      const k = index(x, y);
      const item = game.items[k];
      if (item) {
        game.items[k] = null;
        game.mapVersion++;
        if (item === 'count') p.count = Math.min(LIMIT.count, p.count + 1);
        if (item === 'range') p.range = Math.min(LIMIT.range, p.range + 1);
        if (item === 'speed') p.speed = Math.min(SPEED.max, +(p.speed + SPEED.step).toFixed(2));
        game.events.push({ type: 'item', player: i, item });
      }
    }
  });

  const left = game.players.filter((p) => p.alive);
  if (left.length <= 1) {
    game.phase = 'over';
    game.winner = left.length ? game.players.indexOf(left[0]) : null;
    if (left[0]) left[0].trapped = 0;
    game.events.push({ type: 'over', winner: game.winner });
  } else if (game.time >= game.limit) {
    game.phase = 'over';
    game.winner = null;
    game.events.push({ type: 'over', winner: null });
  }
  return game;
}

export const DIRECTIONS = DIRS;
