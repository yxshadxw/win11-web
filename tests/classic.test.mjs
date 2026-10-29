import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { ClassicServer, packets, str, wrap } from '../classic/server.mjs';
import { generate, World, B } from '../classic/world.mjs';
import { upgrade, FrameDecoder, encodeFrame } from '../websocket.mjs';

const SIZES = { 0x00: 131, 0x01: 1, 0x02: 1, 0x03: 1028, 0x04: 7, 0x06: 8, 0x07: 74, 0x08: 10, 0x0c: 2, 0x0d: 66, 0x0e: 65 };

function ident(name) {
  return Buffer.concat([Buffer.from([0x00, 7]), str(name), str(''), Buffer.from([0])]);
}

/** A test player speaking the protocol over a real WebSocket. */
async function player(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`, 'ClassiCube');
  ws.binaryType = 'arraybuffer';
  const got = [];
  let buffer = Buffer.alloc(0);
  const waiters = [];
  ws.onmessage = (e) => {
    buffer = Buffer.concat([buffer, Buffer.from(e.data)]);
    while (buffer.length && buffer.length >= SIZES[buffer[0]]) {
      got.push(buffer.subarray(0, SIZES[buffer[0]]));
      buffer = buffer.subarray(SIZES[buffer[0]]);
    }
    for (const w of [...waiters]) w();
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  assert.equal(ws.protocol, 'ClassiCube');
  ws.send(ident(name));
  const until = (test) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting on ${name}`)), 3000);
    const check = () => { const hit = got.find(test); if (hit) { clearTimeout(timer); waiters.splice(waiters.indexOf(check), 1); resolve(hit); } };
    waiters.push(check);
    check();
  });
  return { ws, got, until };
}

test('world generation is seeded and round-trips through the save format', () => {
  const a = generate({ x: 64, y: 32, z: 64, seed: 5 });
  assert.deepEqual(a.blocks, generate({ x: 64, y: 32, z: 64, seed: 5 }).blocks);
  assert.equal(a.get(10, 0, 10), B.BEDROCK);
  const b = World.deserialize(a.serialize());
  assert.deepEqual(b.blocks, a.blocks);
  const level = gunzipSync(a.level());
  assert.equal(level.readUInt32BE(0), 64 * 32 * 64);
});

test('websocket frames decode masked, fragmented input', () => {
  const mask = Buffer.from([1, 2, 3, 4]);
  const frame = (fin, opcode, data) => {
    const masked = Buffer.from(data).map((v, i) => v ^ mask[i & 3]);
    return Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | data.length]), mask, masked]);
  };
  const d = new FrameDecoder();
  const both = Buffer.concat([frame(false, 2, [1, 2]), frame(true, 0, [3])]);
  assert.deepEqual(d.push(both.subarray(0, 5)), []);
  const [msg] = d.push(both.subarray(5));
  assert.deepEqual([...msg.data], [1, 2, 3]);
  assert.equal(encodeFrame(Buffer.alloc(300))[1], 126);
  assert.throws(() => new FrameDecoder().push(Buffer.from([0x82, 0x01, 0x00])), /masked/);
});

test('chat wraps at 64 characters and keeps its colour', () => {
  const lines = wrap('&e' + 'x'.repeat(100));
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.length <= 64));
  assert.ok(lines[1].startsWith('&e'));
});

test('two players join, see each other, and share block changes', async () => {
  const classic = new ClassicServer({ world: generate({ x: 64, y: 32, z: 64, seed: 2 }), persist: false });
  const http = createServer();
  http.on('upgrade', (req, socket, head) => {
    const ws = upgrade(req, socket, head, { protocol: 'ClassiCube' });
    const link = classic.connect({ ip: 'test', send: (b) => ws.send(b), close: () => ws.close() });
    ws.onmessage = link.receive;
    ws.onclose = link.closed;
  });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  const { port } = http.address();
  try {
    const alice = await player(port, 'Alice');
    const final = await alice.until((p) => p[0] === 0x04);
    assert.deepEqual([final.readInt16BE(1), final.readInt16BE(3), final.readInt16BE(5)], [64, 32, 64]);
    const chunks = alice.got.filter((p) => p[0] === 0x03);
    const level = gunzipSync(Buffer.concat(chunks.map((c) => c.subarray(3, 3 + c.readInt16BE(1)))));
    assert.equal(level.readUInt32BE(0), 64 * 32 * 64);
    const self = await alice.until((p) => p[0] === 0x07);
    assert.equal(self.readInt8(1), -1);

    const bob = await player(port, 'Bob');
    const seen = await bob.until((p) => p[0] === 0x07 && p.toString('latin1', 2, 7) === 'Alice');
    assert.equal(seen.readInt8(1), 0);
    await alice.until((p) => p[0] === 0x07 && p.toString('latin1', 2, 5) === 'Bob');

    // Alice builds right at spawn; Bob sees it.
    const { x, y, z } = classic.players.get(0).pos;
    const bx = Math.floor(x / 32), by = Math.floor(y / 32), bz = Math.floor(z / 32) + 2;
    const place = Buffer.alloc(9);
    place[0] = 0x05; place.writeInt16BE(bx, 1); place.writeInt16BE(by, 3); place.writeInt16BE(bz, 5); place[7] = 1; place[8] = B.GLASS;
    alice.ws.send(place);
    const update = await bob.until((p) => p[0] === 0x06);
    assert.equal(update[7], B.GLASS);
    assert.equal(classic.world.get(bx, by, bz), B.GLASS);

    // Bedrock and far-away edits are refused and reverted for the sender.
    place.writeInt16BE(0, 3); place[7] = 0;
    alice.ws.send(place);
    const revert = await alice.until((p) => p[0] === 0x06 && p.readInt16BE(3) === 0);
    assert.notEqual(revert[7], B.AIR);

    // Chat reaches everyone; moving is relayed with the mover's id.
    alice.ws.send(Buffer.concat([Buffer.from([0x0d, 0xff]), str('hello')]));
    const chat = await bob.until((p) => p[0] === 0x0d && p.toString('latin1').includes('Alice: &fhello'));
    assert.ok(chat);
    const move = Buffer.alloc(10);
    move[0] = 0x08; move[1] = 0xff; move.writeInt16BE(100, 2); move.writeInt16BE(900, 4); move.writeInt16BE(100, 6);
    alice.ws.send(move);
    const moved = await bob.until((p) => p[0] === 0x08 && p.readInt16BE(2) === 100);
    assert.equal(moved.readInt8(1), 0);

    alice.ws.close();
    await bob.until((p) => p[0] === 0x0c);
    assert.deepEqual(classic.status().players, ['Bob']);
    bob.ws.close();
  } finally {
    classic.stop();
    http.close();
    http.closeAllConnections?.();
  }
});

test('bad names and duplicate logins are handled', async () => {
  const classic = new ClassicServer({ world: generate({ x: 32, y: 16, z: 32 }), persist: false });
  const sent = [];
  const link = classic.connect({ ip: 'x', send: (b) => sent.push(b), close() {} });
  link.receive(ident('bad name!'));
  assert.equal(sent[0][0], 0x0e);
  const a = []; const first = classic.connect({ ip: 'y', send: (b) => a.push(b), close() {} });
  first.receive(ident('Same'));
  const second = classic.connect({ ip: 'z', send() {}, close() {} });
  second.receive(ident('same'));
  assert.ok(a.some((p) => p[0] === 0x0e), 'the older session is kicked');
  classic.stop();
  assert.ok(packets.ping().length === 1);
});
