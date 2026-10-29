// Just enough of RFC 6455 for binary game traffic: the server handshake, masked client
// frames (including fragments, ping and close) and unmasked server frames.
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 1 << 20;

export function acceptKey(key) {
  return createHash('sha1').update(key + GUID).digest('base64');
}

/** Encode one unfragmented server→client frame. */
export function encodeFrame(payload, opcode = 2) {
  const length = payload.length;
  const head = length < 126 ? 2 : length < 65536 ? 4 : 10;
  const frame = Buffer.allocUnsafe(head + length);
  frame[0] = 0x80 | opcode;
  if (length < 126) frame[1] = length;
  else if (length < 65536) { frame[1] = 126; frame.writeUInt16BE(length, 2); }
  else { frame[1] = 127; frame.writeBigUInt64BE(BigInt(length), 2); }
  frame.set(payload, head);
  return frame;
}

/**
 * Incremental frame decoder. push(bytes) returns the complete messages so far as
 * { opcode, data } (fragments are joined). Throws on protocol violations.
 */
export class FrameDecoder {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.parts = [];
    this.partOpcode = 0;
  }

  push(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const out = [];
    for (;;) {
      const b = this.buffer;
      if (b.length < 2) break;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let length = b[1] & 0x7f;
      let at = 2;
      if (length === 126) {
        if (b.length < 4) break;
        length = b.readUInt16BE(2);
        at = 4;
      } else if (length === 127) {
        if (b.length < 10) break;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) throw new Error('frame too large');
        length = Number(big);
        at = 10;
      }
      if (!masked) throw new Error('client frames must be masked');
      if (length > MAX_MESSAGE) throw new Error('frame too large');
      if (b.length < at + 4 + length) break;
      const mask = b.subarray(at, at + 4);
      const data = Buffer.from(b.subarray(at + 4, at + 4 + length));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buffer = b.subarray(at + 4 + length);
      if (opcode >= 8) { out.push({ opcode, data }); continue; } // control frames are never fragmented
      if (opcode !== 0) this.partOpcode = opcode;
      this.parts.push(data);
      if (this.parts.reduce((n, p) => n + p.length, 0) > MAX_MESSAGE) throw new Error('message too large');
      if (fin) {
        out.push({ opcode: this.partOpcode, data: Buffer.concat(this.parts) });
        this.parts = [];
      }
    }
    return out;
  }
}

/**
 * Finish a WebSocket upgrade on `socket`. Returns a small connection object with
 * send(buffer), close(), and onmessage / onclose hooks, or null if the request is not a
 * valid upgrade.
 */
export function upgrade(req, socket, head, { protocol } = {}) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const offered = String(req.headers['sec-websocket-protocol'] || '').split(',').map((s) => s.trim());
  const lines = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(key)}`,
  ];
  if (protocol && offered.includes(protocol)) lines.push(`Sec-WebSocket-Protocol: ${protocol}`);
  socket.write(lines.join('\r\n') + '\r\n\r\n');
  socket.setNoDelay(true);

  const decoder = new FrameDecoder();
  let closed = false;
  const conn = {
    onmessage: () => {},
    onclose: () => {},
    send(data) { if (!closed && socket.writable) socket.write(encodeFrame(Buffer.from(data))); },
    close(code = 1000) {
      if (closed) return;
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(code);
      if (socket.writable) socket.write(encodeFrame(payload, 8));
      socket.end();
      finish();
    },
    get bufferedAmount() { return socket.writableLength; },
  };
  function finish() {
    if (closed) return;
    closed = true;
    conn.onclose();
  }
  function onData(chunk) {
    let messages;
    try { messages = decoder.push(chunk); } catch { socket.destroy(); finish(); return; }
    for (const { opcode, data } of messages) {
      if (opcode === 8) { conn.close(); return; }
      if (opcode === 9) { if (socket.writable) socket.write(encodeFrame(data, 10)); continue; }
      if (opcode === 1 || opcode === 2) conn.onmessage(data);
    }
  }
  socket.on('data', onData);
  socket.on('close', finish);
  socket.on('error', finish);
  if (head?.length) queueMicrotask(() => onData(head));
  return conn;
}
