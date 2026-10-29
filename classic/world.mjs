// Block world in the Minecraft Classic layout: one byte per block, index (y * Z + z) * X + x.
import { gzipSync, gunzipSync } from 'node:zlib';

export const B = {
  AIR: 0, STONE: 1, GRASS: 2, DIRT: 3, COBBLE: 4, PLANKS: 5, SAPLING: 6, BEDROCK: 7,
  WATER: 8, STILL_WATER: 9, LAVA: 10, STILL_LAVA: 11, SAND: 12, GRAVEL: 13,
  GOLD_ORE: 14, IRON_ORE: 15, COAL_ORE: 16, LOG: 17, LEAVES: 18, SPONGE: 19, GLASS: 20,
  DANDELION: 37, ROSE: 38, BROWN_MUSHROOM: 39, RED_MUSHROOM: 40, OBSIDIAN: 49,
};
export const LAST_BLOCK = 49;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 2D value noise in [0, 1). */
function noise2(seed) {
  const random = rng(seed);
  const size = 256;
  const table = Float64Array.from({ length: size * size }, () => random());
  const at = (x, z) => table[((z & 255) << 8) | (x & 255)];
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, z) => {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const fx = fade(x - x0);
    const fz = fade(z - z0);
    const a = at(x0, z0) + (at(x0 + 1, z0) - at(x0, z0)) * fx;
    const b = at(x0, z0 + 1) + (at(x0 + 1, z0 + 1) - at(x0, z0 + 1)) * fx;
    return a + (b - a) * fz;
  };
}

export class World {
  constructor(x, y, z, blocks = new Uint8Array(x * y * z)) {
    Object.assign(this, { x, y, z, blocks });
    this.dirty = false;
    this.version = 0;
    this.packed = null;
  }

  index(x, y, z) { return (y * this.z + z) * this.x + x; }
  inside(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.x && y < this.y && z < this.z; }
  get(x, y, z) { return this.inside(x, y, z) ? this.blocks[this.index(x, y, z)] : B.BEDROCK; }

  set(x, y, z, block) {
    if (!this.inside(x, y, z)) return false;
    const i = this.index(x, y, z);
    if (this.blocks[i] === block) return false;
    this.blocks[i] = block;
    this.dirty = true;
    this.version++;
    this.packed = null;
    return true;
  }

  /** Highest non-air y in a column, or -1. */
  top(x, z) {
    for (let y = this.y - 1; y >= 0; y--) if (this.get(x, y, z) !== B.AIR) return y;
    return -1;
  }

  /** The level as Classic clients receive it: gzip(int32 length + blocks). Cached. */
  level() {
    if (!this.packed) {
      const raw = Buffer.alloc(4 + this.blocks.length);
      raw.writeUInt32BE(this.blocks.length, 0);
      raw.set(this.blocks, 4);
      this.packed = gzipSync(raw, { level: 6 });
    }
    return this.packed;
  }

  /** Save file: 6-byte header (dimensions) + gzip of the blocks. */
  serialize() {
    const head = Buffer.alloc(6);
    head.writeUInt16BE(this.x, 0);
    head.writeUInt16BE(this.y, 2);
    head.writeUInt16BE(this.z, 4);
    return Buffer.concat([head, gzipSync(this.blocks)]);
  }

  static deserialize(buf) {
    const x = buf.readUInt16BE(0);
    const y = buf.readUInt16BE(2);
    const z = buf.readUInt16BE(4);
    const blocks = new Uint8Array(gunzipSync(buf.subarray(6)));
    if (blocks.length !== x * y * z) throw new Error('world size mismatch');
    return new World(x, y, z, blocks);
  }
}

/** Rolling hills with beaches, lakes, ores and trees. */
export function generate({ x = 128, y = 64, z = 128, seed = 1 } = {}) {
  const world = new World(x, y, z);
  const random = rng(seed);
  const hills = noise2(seed);
  const detail = noise2(seed + 1);
  const water = Math.floor(y / 2);
  const heights = new Int16Array(x * z);
  for (let cz = 0; cz < z; cz++) {
    for (let cx = 0; cx < x; cx++) {
      const h = hills(cx / 32, cz / 32) * 18 + detail(cx / 9, cz / 9) * 6 + water - 10;
      heights[cz * x + cx] = Math.max(2, Math.min(y - 8, Math.round(h)));
    }
  }
  const put = (px, py, pz, b) => { world.blocks[world.index(px, py, pz)] = b; };
  for (let cz = 0; cz < z; cz++) {
    for (let cx = 0; cx < x; cx++) {
      const h = heights[cz * x + cx];
      const beach = h <= water + 1;
      for (let cy = 0; cy <= Math.max(h, water - 1); cy++) {
        let b;
        if (cy === 0) b = B.BEDROCK;
        else if (cy > h) b = B.STILL_WATER;
        else if (cy < h - 3) {
          const r = random();
          b = r < 0.012 ? B.COAL_ORE : r < 0.018 && cy < water - 6 ? B.IRON_ORE : r < 0.0205 && cy < 12 ? B.GOLD_ORE : B.STONE;
        } else if (cy < h) b = beach ? B.SAND : B.DIRT;
        else b = beach ? (h < water - 2 ? B.GRAVEL : B.SAND) : B.GRASS;
        put(cx, cy, cz, b);
      }
    }
  }
  // Trees and flowers on grass, away from the edges.
  for (let n = 0; n < (x * z) / 90; n++) {
    const cx = 3 + Math.floor(random() * (x - 6));
    const cz = 3 + Math.floor(random() * (z - 6));
    const h = heights[cz * x + cx];
    if (world.get(cx, h, cz) !== B.GRASS || h + 8 >= y) continue;
    if (random() < 0.35) { put(cx, h + 1, cz, random() < 0.5 ? B.DANDELION : B.ROSE); continue; }
    const trunk = 4 + Math.floor(random() * 2);
    for (let t = 1; t <= trunk; t++) put(cx, h + t, cz, B.LOG);
    for (let ly = h + trunk - 2; ly <= h + trunk + 1; ly++) {
      const r = ly > h + trunk - 1 ? 1 : 2;
      for (let lx = cx - r; lx <= cx + r; lx++) {
        for (let lz = cz - r; lz <= cz + r; lz++) {
          if (Math.abs(lx - cx) === r && Math.abs(lz - cz) === r && random() < 0.5) continue;
          if (world.get(lx, ly, lz) === B.AIR) put(lx, ly, lz, B.LEAVES);
        }
      }
    }
    put(cx, h, cz, B.DIRT);
  }
  return world;
}
