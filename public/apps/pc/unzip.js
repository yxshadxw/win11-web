// Minimal ZIP reader (stored and deflate entries) on top of the built-in DecompressionStream,
// so a game archive can be dropped onto the emulator without any library.
async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const decoder = new TextDecoder();
const cp437 = (() => {
  try { return new TextDecoder('ibm866'); } catch { return decoder; } // close enough for names
})();

/** Returns [{ path, data }] for every file in the archive. */
export async function unzip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('ZIP 파일이 아닙니다.');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('ZIP 목록이 손상되었습니다.');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const rawName = bytes.subarray(at + 46, at + 46 + nameLength);
    const path = (flags & 0x800 ? decoder : cp437).decode(rawName);
    at += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith('/')) continue;
    if (flags & 1) throw new Error(`암호가 걸린 ZIP은 열 수 없습니다: ${path}`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const body = bytes.subarray(start, start + compressed);
    if (method === 0) out.push({ path, data: body.slice() });
    else if (method === 8) out.push({ path, data: await inflate(body) });
    else throw new Error(`지원하지 않는 압축 방식입니다: ${path}`);
  }
  return out;
}
