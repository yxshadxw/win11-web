import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { buildDisk, shortName, isWindowsExe, tree } from '../public/apps/pc/disk.js';
import { unzip } from '../public/apps/pc/unzip.js';

/** Read a file back out of the image by walking the FAT, like DOS would. */
function readBack(img, path) {
  const v = new DataView(img.buffer);
  const base = v.getUint32(446 + 8, true) * 512;
  const spc = img[base + 13];
  const fats = img[base + 16];
  const fatSize = v.getUint16(base + 22, true);
  const rootEntries = v.getUint16(base + 17, true);
  const fat = base + 512;
  const root = fat + fats * fatSize * 512;
  const data = root + rootEntries * 32;
  const cluster = (c) => data + (c - 2) * spc * 512;
  const chain = (c) => { const out = []; while (c >= 2 && c < 0xfff8) { out.push(c); c = v.getUint16(fat + c * 2, true); } return out; };
  let dir = { at: root, count: rootEntries };
  const parts = path.split('/');
  for (let i = 0; i < parts.length; i++) {
    const want = parts[i].padEnd(11);
    let hit = null;
    for (let e = 0; e < dir.count; e++) {
      const at = dir.at + e * 32;
      if (img[at] === 0) break;
      if (img[at + 11] === 0x0f) continue;
      if (String.fromCharCode(...img.subarray(at, at + 11)) === want) { hit = at; break; }
    }
    assert.ok(hit !== null, `missing ${parts[i]}`);
    const first = v.getUint16(hit + 26, true);
    if (i < parts.length - 1) { dir = { at: cluster(first), count: (spc * 512) / 32 }; continue; }
    const size = v.getUint32(hit + 28, true);
    const out = new Uint8Array(size);
    let pos = 0;
    for (const c of chain(first)) { const n = Math.min(spc * 512, size - pos); out.set(img.subarray(cluster(c), cluster(c) + n), pos); pos += n; }
    return out;
  }
}

test('8.3 names are made unique and long names are shortened', () => {
  const taken = new Set();
  const a = shortName('README.TXT', taken); taken.add(a.short);
  assert.deepEqual(a, { short: 'README  TXT', lossy: false });
  const b = shortName('Long File Name.exe', taken); taken.add(b.short);
  assert.equal(b.short, 'LONGFI~1EXE');
  assert.equal(shortName('Long File Name 2.exe', taken).short, 'LONGFI~2EXE');
});

test('files and folders survive the trip through the FAT16 image', () => {
  const big = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7) & 255);
  const img = buildDisk([
    { path: 'GAME.EXE', data: big },
    { path: 'keen/KEEN1.EXE', data: new Uint8Array([1, 2, 3]) },
    { path: 'keen/data/LEVEL01.CK1', data: new Uint8Array(5000).fill(9) },
  ]);
  assert.equal(img.length % (512 * 16 * 63), 0, 'whole cylinders');
  assert.deepEqual([img[510], img[511]], [0x55, 0xaa]);
  assert.deepEqual(readBack(img, 'GAME    EXE'), big);
  assert.deepEqual([...readBack(img, 'KEEN       /KEEN1   EXE')], [1, 2, 3]);
  assert.equal(readBack(img, 'KEEN       /DATA       /LEVEL01 CK1').length, 5000);
  assert.equal(tree([{ path: '../x/./y.txt', data: new Uint8Array(1) }]).children.get('X').children.size, 1);
});

test('Windows programs are told apart from DOS ones', () => {
  const dos = new Uint8Array(0x80); dos[0] = 0x4d; dos[1] = 0x5a;
  assert.equal(isWindowsExe(dos), false);
  const pe = new Uint8Array(0x100); pe[0] = 0x4d; pe[1] = 0x5a; pe[0x3c] = 0x80; pe.set([0x50, 0x45, 0, 0], 0x80);
  assert.equal(isWindowsExe(pe), true);
});

test('zip archives unpack (stored and deflated)', async () => {
  const entries = [['A.TXT', Buffer.from('stored'), 0], ['dir/B.TXT', Buffer.from('deflated '.repeat(20)), 8]];
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, data, method] of entries) {
    const body = method ? deflateRawSync(data) : data;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(method, 10); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, body); centrals.push(central, n); offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(2, 8); end.writeUInt16LE(2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  const files = await unzip(Buffer.concat([...locals, cd, end]));
  assert.deepEqual(files.map((f) => f.path), ['A.TXT', 'dir/B.TXT']);
  assert.equal(Buffer.from(files[1].data).toString(), 'deflated '.repeat(20));
  await assert.rejects(unzip(Buffer.from('not a zip')), /ZIP/);
});
