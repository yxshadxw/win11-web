// Builds a FAT16 hard-disk image (MBR + one partition) from plain files, so programs from
// the host can be handed to DOS or Windows 9x inside the emulator as drive C: or D:.
// Long file names get VFAT entries; DOS sees the 8.3 short names.
const SECTOR = 512;
const HEADS = 16;
const SPT = 63;
const START = 63; // first partition sector, as classic partitioning tools do
const MB = 1024 * 1024;

const encoder = new TextEncoder();

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = (Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const SHORT_OK = /^[A-Z0-9!#$%&'()\-@^_`{}~]+$/;

function cleanPart(text) {
  return [...text.toUpperCase()].map((c) => (SHORT_OK.test(c) ? c : c === ' ' ? '' : '_')).join('');
}

/** 8.3 name (11 bytes, space padded) that is unique within `taken`. */
export function shortName(name, taken) {
  const dot = name.lastIndexOf('.');
  const rawBase = dot > 0 ? name.slice(0, dot) : name;
  const rawExt = dot > 0 ? name.slice(dot + 1) : '';
  const base = cleanPart(rawBase) || '_';
  const ext = cleanPart(rawExt).slice(0, 3);
  // Only case differs: keep the name (a VFAT entry remembers the original case).
  const exact = base.length <= 8 && base === rawBase.toUpperCase() && ext === rawExt.toUpperCase() && !taken.has(base.padEnd(8) + ext.padEnd(3));
  if (exact) return { short: base.padEnd(8) + ext.padEnd(3), lossy: false };
  for (let n = 1; n < 1000000; n++) {
    const tail = `~${n}`;
    const candidate = (base.slice(0, 8 - tail.length) + tail).padEnd(8) + ext.padEnd(3);
    if (!taken.has(candidate)) return { short: candidate, lossy: true };
  }
  throw new Error('too many similar file names');
}

function lfnChecksum(short) {
  let sum = 0;
  for (let i = 0; i < 11; i++) sum = (((sum & 1) << 7) | (sum >> 1)) + short.charCodeAt(i) & 0xff;
  return sum;
}

/** VFAT long-name entries for `name`, in on-disk order (last part first). */
function lfnEntries(name, short) {
  const units = [...name].flatMap((c) => {
    const code = c.codePointAt(0);
    if (code <= 0xffff) return [code];
    const v = code - 0x10000;
    return [0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)];
  });
  const count = Math.ceil((units.length + 1) / 13);
  const padded = [...units, 0, ...Array(count * 13).fill(0xffff)].slice(0, count * 13);
  const sum = lfnChecksum(short);
  const out = [];
  for (let i = count; i >= 1; i--) {
    const e = new Uint8Array(32);
    const v = new DataView(e.buffer);
    e[0] = i | (i === count ? 0x40 : 0);
    e[11] = 0x0f;
    e[13] = sum;
    const part = padded.slice((i - 1) * 13, i * 13);
    const offsets = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30];
    part.forEach((u, j) => v.setUint16(offsets[j], u, true));
    out.push(e);
  }
  return out;
}

/** Turns [{ path: 'GAME/RUN.EXE', data }] into a directory tree. */
export function tree(files) {
  const root = { name: '', dir: true, children: new Map() };
  for (const { path, data } of files) {
    const parts = String(path).replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..');
    if (!parts.length) continue;
    let node = root;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      const key = part.toUpperCase();
      if (last && data) {
        node.children.set(key, { name: part, dir: false, data });
        return;
      }
      let next = node.children.get(key);
      if (!next || !next.dir) {
        next = { name: part, dir: true, children: new Map() };
        node.children.set(key, next);
      }
      node = next;
    });
  }
  return root;
}

function entryCount(node) {
  let n = 0;
  const taken = new Set();
  for (const child of node.children.values()) {
    const { short, lossy } = shortName(child.name, taken);
    taken.add(short);
    child.short = short;
    child.lfn = lossy || child.name !== child.name.toUpperCase() ? lfnEntries(child.name, short) : [];
    n += 1 + child.lfn.length;
  }
  return n;
}

function layout(totalBytes) {
  // Leave room to save games, and stay under the 504 MB CHS limit DOS relies on.
  const wanted = Math.max(32 * MB, Math.ceil((totalBytes * 1.15 + 4 * MB) / MB) * MB);
  if (wanted > 500 * MB) throw new Error('파일이 너무 큽니다. 한 번에 약 450MB까지 넣을 수 있습니다.');
  const cylinders = Math.ceil(wanted / SECTOR / (HEADS * SPT));
  const total = cylinders * HEADS * SPT;
  const part = total - START;
  let spc = 4;
  while (part / spc > 65000) spc *= 2;
  const rootEntries = 512;
  const rootSectors = (rootEntries * 32) / SECTOR;
  let fatSectors = 1;
  for (;;) {
    const clusters = Math.floor((part - 1 - 2 * fatSectors - rootSectors) / spc);
    const need = Math.ceil(((clusters + 2) * 2) / SECTOR);
    if (need <= fatSectors) return { cylinders, total, part, spc, rootEntries, rootSectors, fatSectors, clusters };
    fatSectors = need;
  }
}

function chs(lba) {
  const c = Math.floor(lba / (HEADS * SPT));
  const h = Math.floor(lba / SPT) % HEADS;
  const s = (lba % SPT) + 1;
  const cc = Math.min(c, 1023);
  return [h, s | ((cc >> 2) & 0xc0), cc & 0xff];
}

/**
 * Build the disk. `files` = [{ path, data: Uint8Array }]. Returns a Uint8Array whose length
 * is a whole number of cylinders, ready for v86's hda/hdb.
 */
export function buildDisk(files, { label = 'WIN11WEB', date = new Date() } = {}) {
  const root = tree(files);
  const fileBytes = files.reduce((n, f) => n + (f.data?.length || 0), 0);
  const L = layout(fileBytes + 64 * 1024);
  const clusterBytes = L.spc * SECTOR;
  const image = new Uint8Array(L.total * SECTOR);
  const view = new DataView(image.buffer);
  const base = START * SECTOR;
  const fatStart = base + SECTOR;
  const rootStart = fatStart + 2 * L.fatSectors * SECTOR;
  const dataStart = rootStart + L.rootSectors * SECTOR;
  const fat = new Uint16Array(L.clusters + 2);
  fat[0] = 0xfff8;
  fat[1] = 0xffff;
  let next = 2;
  const { time, day } = dosDateTime(date);

  function allocate(bytes) {
    const count = Math.max(1, Math.ceil(bytes / clusterBytes));
    if (next + count > L.clusters + 2) throw new Error('디스크 공간이 부족합니다.');
    const first = next;
    for (let i = 0; i < count; i++) fat[next + i] = i === count - 1 ? 0xffff : next + i + 1;
    next += count;
    return first;
  }
  const clusterOffset = (c) => dataStart + (c - 2) * clusterBytes;

  function writeEntry(at, short, attr, cluster, size) {
    for (let i = 0; i < 11; i++) image[at + i] = short.charCodeAt(i);
    image[at + 11] = attr;
    view.setUint16(at + 14, time, true);
    view.setUint16(at + 16, day, true);
    view.setUint16(at + 18, day, true);
    view.setUint16(at + 22, time, true);
    view.setUint16(at + 24, day, true);
    view.setUint16(at + 26, cluster, true);
    view.setUint32(at + 28, size, true);
  }

  // Lay out a directory's entries starting at byte `at`; returns nothing, recursing into subdirs.
  function writeDir(node, at, self, parent) {
    let pos = at;
    if (self) {
      writeEntry(pos, '.          ', 0x10, self, 0);
      writeEntry(pos + 32, '..         ', 0x10, parent, 0);
      pos += 64;
    }
    for (const child of node.children.values()) {
      for (const e of child.lfn) { image.set(e, pos); pos += 32; }
      if (child.dir) {
        const entries = entryCount(child) + 2;
        const cluster = allocate(entries * 32);
        writeEntry(pos, child.short, 0x10, cluster, 0);
        writeDir(child, clusterOffset(cluster), cluster, self);
      } else {
        const size = child.data.length;
        const cluster = size ? allocate(size) : 0;
        if (size) image.set(child.data, clusterOffset(cluster));
        writeEntry(pos, child.short, 0x20, cluster, size);
      }
      pos += 32;
    }
  }

  const rootCount = entryCount(root) + 1;
  if (rootCount > L.rootEntries) throw new Error('맨 위 폴더에 파일이 너무 많습니다. 폴더로 묶어 주세요.');
  const vol = cleanPart(label).slice(0, 11).padEnd(11);
  writeEntry(rootStart, vol, 0x08, 0, 0);
  writeDir(root, rootStart + 32, 0, 0);

  // FATs (two identical copies).
  for (let copy = 0; copy < 2; copy++) {
    const at = fatStart + copy * L.fatSectors * SECTOR;
    for (let i = 0; i < fat.length; i++) view.setUint16(at + i * 2, fat[i], true);
  }

  // Partition boot sector with the BIOS parameter block.
  image.set([0xeb, 0x3c, 0x90], base);
  image.set(encoder.encode('WIN11WEB'), base + 3);
  view.setUint16(base + 11, SECTOR, true);
  image[base + 13] = L.spc;
  view.setUint16(base + 14, 1, true);
  image[base + 16] = 2;
  view.setUint16(base + 17, L.rootEntries, true);
  view.setUint16(base + 19, L.part < 65536 ? L.part : 0, true);
  image[base + 21] = 0xf8;
  view.setUint16(base + 22, L.fatSectors, true);
  view.setUint16(base + 24, SPT, true);
  view.setUint16(base + 26, HEADS, true);
  view.setUint32(base + 28, START, true);
  view.setUint32(base + 32, L.part < 65536 ? 0 : L.part, true);
  image[base + 36] = 0x80;
  image[base + 38] = 0x29;
  view.setUint32(base + 39, (date.getTime() / 1000) >>> 0, true);
  image.set(encoder.encode(vol), base + 43);
  image.set(encoder.encode('FAT16   '), base + 54);
  image.set([0xcd, 0x18], base + 62); // not bootable: hand back to the BIOS
  image.set([0x55, 0xaa], base + 510);

  // Master boot record with a single FAT16 partition.
  const entry = 446;
  image.set(chs(START), entry + 1);
  image[entry + 4] = L.part < 65536 ? 0x04 : 0x06;
  image.set(chs(L.total - 1), entry + 5);
  view.setUint32(entry + 8, START, true);
  view.setUint32(entry + 12, L.part, true);
  image.set([0x55, 0xaa], 510);
  return image;
}

/** Is this a Windows (PE) program rather than a DOS one? */
export function isWindowsExe(bytes) {
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return false;
  const pe = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0x3c, true);
  return pe + 4 <= bytes.length && bytes[pe] === 0x50 && bytes[pe + 1] === 0x45 && bytes[pe + 2] === 0 && bytes[pe + 3] === 0;
}
