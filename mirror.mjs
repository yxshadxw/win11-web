// Fetch a file from an upstream URL once and keep it in a local cache directory. Used for
// assets the browser should load from this origin (emulator disk images, texture packs).
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const CACHE_DIR = process.env.MIRROR_CACHE || process.env.PC_IMAGE_CACHE || join(tmpdir(), 'win11web-mirror');
const jobs = new Map();

/** Path of the cached copy of `url`, downloading it first if needed. */
export async function cached(url, name, { size = 0, max = 64 * 1024 * 1024 } = {}) {
  const target = join(CACHE_DIR, name);
  try {
    const info = await stat(target);
    if (!size || info.size === size) return target;
  } catch { /* not cached yet */ }
  if (jobs.has(target)) return jobs.get(target);
  const job = (async () => {
    await mkdir(CACHE_DIR, { recursive: true });
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok || !res.body) throw new Error(`upstream answered ${res.status}`);
    if (Number(res.headers.get('content-length') || 0) > max) throw new Error('file too large');
    const partial = `${target}.${process.pid}.part`;
    let seen = 0;
    const body = Readable.fromWeb(res.body);
    body.on('data', (chunk) => {
      seen += chunk.length;
      if (seen > max) body.destroy(new Error('file too large'));
    });
    try {
      await pipeline(body, createWriteStream(partial));
      if (size && seen !== size) throw new Error(`expected ${size} bytes, got ${seen}`);
      await rename(partial, target);
    } catch (err) {
      await unlink(partial).catch(() => {});
      throw err;
    }
    return target;
  })();
  jobs.set(target, job);
  try { return await job; } finally { jobs.delete(target); }
}

/** Serve a cached upstream file, or a 502 explaining why it could not be fetched. */
export async function serveCached(req, res, url, name, { type = 'application/octet-stream', ...options } = {}) {
  try {
    const file = await cached(url, name, options);
    const { size } = await stat(file);
    res.writeHead(200, { 'content-type': type, 'content-length': size, 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*' });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  } catch (err) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`파일을 가져오지 못했습니다 (${err.message}).`);
  }
}
