// Minecraft Classic (protocol 7) multiplayer server, the protocol the open-source ClassiCube
// client speaks. Players connect from the browser over WebSocket (subprotocol "ClassiCube"),
// or, if CLASSIC_TCP_PORT is set, from the desktop client over plain TCP.
import { createServer as createTcpServer } from 'node:net';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { World, generate, B, LAST_BLOCK } from './world.mjs';

const PROTOCOL = 7;
const MAX_PLAYERS = Number(process.env.CLASSIC_MAX_PLAYERS || 24);
const PER_IP = 4;
const SERVER_NAME = process.env.CLASSIC_NAME || 'Win11 Web Classic';
const MOTD = process.env.CLASSIC_MOTD || '블록을 놓고 부수며 함께 놀아요 · /help';
const DATA_DIR = process.env.CLASSIC_DATA || join(process.cwd(), 'data');
const SAVE_EVERY_MS = 60_000;
const REACH = 10; // blocks; a little more than the client's own reach
const BLOCKS_PER_SECOND = 40;

// Client → server packet sizes (including the id byte).
const SIZES = { 0x00: 131, 0x05: 9, 0x08: 10, 0x0d: 66 };
// Liquids and bedrock can't be placed by normal players.
const PLACEABLE = new Set(Array.from({ length: LAST_BLOCK }, (_, i) => i + 1).filter((b) => ![B.BEDROCK, B.WATER, B.STILL_WATER, B.LAVA, B.STILL_LAVA].includes(b)));

export function str(text) {
  const out = Buffer.alloc(64, 0x20);
  // Classic strings are code page 437; anything outside ASCII becomes '?'.
  const ascii = [...String(text)].map((c) => (c.charCodeAt(0) < 127 && c.charCodeAt(0) >= 32 ? c : '?')).join('');
  out.write(ascii.slice(0, 64), 'latin1');
  return out;
}
export const readStr = (buf, at) => buf.toString('latin1', at, at + 64).replace(/ +$/, '');

export const packets = {
  ident: (name, motd, op) => Buffer.concat([Buffer.from([0x00, PROTOCOL]), str(name), str(motd), Buffer.from([op ? 0x64 : 0])]),
  ping: () => Buffer.from([0x01]),
  levelInit: () => Buffer.from([0x02]),
  levelChunk(chunk, percent) {
    const b = Buffer.alloc(1028);
    b[0] = 0x03;
    b.writeInt16BE(chunk.length, 1);
    chunk.copy(b, 3);
    b[1027] = percent;
    return b;
  },
  levelFinal(w) {
    const b = Buffer.alloc(7);
    b[0] = 0x04;
    b.writeInt16BE(w.x, 1);
    b.writeInt16BE(w.y, 3);
    b.writeInt16BE(w.z, 5);
    return b;
  },
  setBlock(x, y, z, block) {
    const b = Buffer.alloc(8);
    b[0] = 0x06;
    b.writeInt16BE(x, 1);
    b.writeInt16BE(y, 3);
    b.writeInt16BE(z, 5);
    b[7] = block;
    return b;
  },
  spawn(id, name, p) {
    const b = Buffer.alloc(74);
    b[0] = 0x07;
    b.writeInt8(id, 1);
    str(name).copy(b, 2);
    b.writeInt16BE(p.x, 66);
    b.writeInt16BE(p.y, 68);
    b.writeInt16BE(p.z, 70);
    b[72] = p.yaw;
    b[73] = p.pitch;
    return b;
  },
  teleport(id, p) {
    const b = Buffer.alloc(10);
    b[0] = 0x08;
    b.writeInt8(id, 1);
    b.writeInt16BE(p.x, 2);
    b.writeInt16BE(p.y, 4);
    b.writeInt16BE(p.z, 6);
    b[8] = p.yaw;
    b[9] = p.pitch;
    return b;
  },
  despawn: (id) => Buffer.from([0x0c, id & 0xff]),
  message: (text, id = 0) => Buffer.concat([Buffer.from([0x0d, id & 0xff]), str(text)]),
  kick: (reason) => Buffer.concat([Buffer.from([0x0e]), str(reason)]),
};

/** Split chat into 64-character lines, carrying the colour code onto continuation lines. */
export function wrap(text, width = 64) {
  const lines = [];
  let rest = text;
  let colour = '';
  while (rest.length) {
    let line = colour + rest;
    if (line.length > width) line = line.slice(0, width);
    rest = rest.slice(line.length - colour.length);
    const codes = line.match(/&[0-9a-f]/gi);
    if (codes) colour = codes.at(-1);
    lines.push(line);
  }
  return lines;
}

export class ClassicServer {
  constructor({ world, dataDir = DATA_DIR, persist = true } = {}) {
    this.world = world || generate({ seed: Date.now() & 0xffff });
    this.players = new Map(); // id → player
    this.dataDir = dataDir;
    this.persist = persist;
    this.saveTimer = null;
    this.pingTimer = setInterval(() => this.broadcast(packets.ping()), 2000);
    this.pingTimer.unref?.();
  }

  get spawn() {
    const x = this.world.x >> 1;
    const z = this.world.z >> 1;
    const y = this.world.top(x, z) + 1;
    return { x: x * 32 + 16, y: y * 32 + 51, z: z * 32 + 16, yaw: 0, pitch: 0 };
  }

  async load() {
    if (!this.persist) return;
    try {
      this.world = World.deserialize(await readFile(join(this.dataDir, 'classic-world.bin')));
    } catch { /* first run: keep the generated world */ }
    this.saveTimer = setInterval(() => this.save(), SAVE_EVERY_MS);
    this.saveTimer.unref?.();
  }

  async save() {
    if (!this.persist || !this.world.dirty) return;
    this.world.dirty = false;
    await mkdir(this.dataDir, { recursive: true });
    const file = join(this.dataDir, 'classic-world.bin');
    await writeFile(`${file}.tmp`, this.world.serialize());
    await rename(`${file}.tmp`, file);
  }

  broadcast(packet, except) {
    for (const p of this.players.values()) if (p !== except && p.ready) p.send(packet);
  }

  chat(text, except) {
    for (const line of wrap(text)) this.broadcast(packets.message(line), except);
  }

  status() {
    return { name: SERVER_NAME, motd: MOTD, players: [...this.players.values()].filter((p) => p.ready).map((p) => p.name), max: MAX_PLAYERS, size: [this.world.x, this.world.y, this.world.z] };
  }

  /** Attach a transport: { send(buf), close(), ip }. Returns { receive(buf), closed() }. */
  connect(transport) {
    const sameIp = [...this.players.values()].filter((p) => p.ip === transport.ip).length;
    const player = {
      id: -1, name: '', ip: transport.ip, ready: false, pos: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
      buffer: Buffer.alloc(0), budget: { at: Date.now(), left: BLOCKS_PER_SECOND },
      send: (b) => transport.send(b),
      kick: (reason) => { transport.send(packets.kick(reason)); setTimeout(() => transport.close(), 50); },
    };
    const receive = (chunk) => {
      player.buffer = player.buffer.length ? Buffer.concat([player.buffer, chunk]) : Buffer.from(chunk);
      while (player.buffer.length) {
        const size = SIZES[player.buffer[0]];
        if (!size) return player.kick('Unknown packet');
        if (player.buffer.length < size) return;
        const packet = player.buffer.subarray(0, size);
        player.buffer = player.buffer.subarray(size);
        this.handle(player, packet, sameIp);
      }
    };
    const closed = () => this.leave(player);
    return { receive, closed };
  }

  handle(player, p, sameIp) {
    const id = p[0];
    if (id === 0x00) return this.login(player, p, sameIp);
    if (!player.ready) return;
    if (id === 0x05) return this.placeBlock(player, p.readInt16BE(1), p.readInt16BE(3), p.readInt16BE(5), p[7], p[8]);
    if (id === 0x08) {
      player.pos = { x: p.readInt16BE(2), y: p.readInt16BE(4), z: p.readInt16BE(6), yaw: p[8], pitch: p[9] };
      return this.broadcast(packets.teleport(player.id, player.pos), player);
    }
    if (id === 0x0d) return this.message(player, readStr(p, 2));
  }

  login(player, p, sameIp) {
    if (player.ready) return;
    const name = readStr(p, 2);
    if (p[1] !== PROTOCOL) return player.kick('Wrong protocol version');
    if (!/^[A-Za-z0-9_.]{1,16}$/.test(name)) return player.kick('Invalid name (A-Z 0-9 _ . only)');
    if (sameIp >= PER_IP) return player.kick('Too many connections from your address');
    const taken = [...this.players.values()].find((o) => o.name.toLowerCase() === name.toLowerCase());
    if (taken) taken.kick('Logged in from somewhere else');
    if (this.players.size >= MAX_PLAYERS) return player.kick('Server is full');
    let id = 0;
    while (this.players.has(id)) id++;
    if (id > 127) return player.kick('Server is full');
    Object.assign(player, { id, name });
    this.players.set(id, player);

    player.send(packets.ident(SERVER_NAME, MOTD, false));
    player.send(packets.levelInit());
    const level = this.world.level();
    for (let at = 0; at < level.length; at += 1024) {
      const chunk = level.subarray(at, at + 1024);
      player.send(packets.levelChunk(chunk, Math.min(100, Math.round(((at + chunk.length) / level.length) * 100))));
    }
    player.send(packets.levelFinal(this.world));
    player.pos = this.spawn;
    player.send(packets.spawn(-1, name, player.pos));
    for (const other of this.players.values()) {
      if (other === player || !other.ready) continue;
      player.send(packets.spawn(other.id, other.name, other.pos));
      other.send(packets.spawn(id, name, player.pos));
    }
    player.ready = true;
    player.send(packets.message(`&eWelcome to ${SERVER_NAME}! &fType /help`));
    this.chat(`&a+ ${name} joined the game`, player);
  }

  placeBlock(player, x, y, z, mode, type) {
    const world = this.world;
    const revert = () => player.send(packets.setBlock(x, y, z, world.get(x, y, z)));
    if (!world.inside(x, y, z)) return;
    const now = Date.now();
    if (now - player.budget.at >= 1000) player.budget = { at: now, left: BLOCKS_PER_SECOND };
    const far = Math.hypot(x - player.pos.x / 32, y - player.pos.y / 32, z - player.pos.z / 32) > REACH;
    if (player.budget.left-- <= 0 || far) return revert();
    const current = world.get(x, y, z);
    let block;
    if (mode === 0) {
      if (current === B.BEDROCK) return revert();
      block = B.AIR;
    } else {
      if (!PLACEABLE.has(type)) return revert();
      block = type;
    }
    if (world.set(x, y, z, block)) this.broadcast(packets.setBlock(x, y, z, block));
  }

  message(player, text) {
    text = text.trim();
    if (!text) return;
    if (text.startsWith('/')) return this.command(player, text.slice(1).split(/\s+/));
    // Players may colour their chat, but '%' codes are not part of vanilla Classic.
    this.chat(`&7${player.name}: &f${text}`);
  }

  command(player, [cmd, ...args]) {
    const say = (t) => wrap(t).forEach((l) => player.send(packets.message(l)));
    switch ((cmd || '').toLowerCase()) {
      case 'help':
        say('&e/who &f- players online   &e/spawn &f- back to spawn');
        say('&e/tp <name> &f- go to a player   &e/me <text> &f- action');
        break;
      case 'who':
        say(`&eOnline (${this.players.size}/${MAX_PLAYERS}): &f${[...this.players.values()].map((p) => p.name).join(', ')}`);
        break;
      case 'spawn':
        player.pos = this.spawn;
        player.send(packets.teleport(-1, player.pos));
        break;
      case 'tp': {
        const target = [...this.players.values()].find((p) => p.name.toLowerCase() === (args[0] || '').toLowerCase());
        if (!target) return say('&cNo such player');
        player.pos = { ...target.pos };
        player.send(packets.teleport(-1, player.pos));
        break;
      }
      case 'me':
        if (args.length) this.chat(`&d* ${player.name} ${args.join(' ')}`);
        break;
      default:
        say('&cUnknown command. Try /help');
    }
  }

  leave(player) {
    if (this.players.get(player.id) !== player) return;
    this.players.delete(player.id);
    if (!player.ready) return;
    this.broadcast(packets.despawn(player.id));
    this.chat(`&c- ${player.name} left the game`);
  }

  /** Optional plain-TCP listener for the desktop ClassiCube client. */
  listenTcp(port) {
    const tcp = createTcpServer((socket) => {
      socket.setNoDelay(true);
      const link = this.connect({ ip: socket.remoteAddress, send: (b) => socket.writable && socket.write(b), close: () => socket.end() });
      socket.on('data', link.receive);
      socket.on('close', link.closed);
      socket.on('error', () => socket.destroy());
    });
    tcp.listen(port);
    return tcp;
  }

  stop() {
    clearInterval(this.pingTimer);
    clearInterval(this.saveTimer);
  }
}
