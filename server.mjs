import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleProxy, PROXY_PATH, rateLimited } from './proxy.mjs';
import { handleYouTube } from './youtube.mjs';
import { handleWeather } from './weather.mjs';
import { handleChess } from './chess-online.mjs';
import { handleBalloon, isInput } from './balloon-online.mjs';
import { handleGostop, gostopTarget } from './gostop.mjs';
import { handlePcImage } from './pc-images.mjs';
import { serveCached } from './mirror.mjs';
import { ClassicServer } from './classic/server.mjs';
import { upgrade } from './websocket.mjs';

const ROOT = resolve(fileURLToPath(new URL('./public', import.meta.url)));
const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || '0.0.0.0';
// Where the separately deployed gostop-next (hwatu-club) server lives.
const GOSTOP_URL = gostopTarget().url;

// Block world shared by everyone who plays ClassiCube on this site.
const classic = new ClassicServer();
await classic.load();
// The ClassiCube web client fetches its default textures from /static/default.zip.
const TEXTURES_URL = process.env.CLASSIC_TEXTURES_URL || 'https://classicube.net/static/default.zip';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

async function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = pathname; }
  let file = normalize(join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return notFound(res);
  try {
    let info = await stat(file);
    if (info.isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { location: pathname + '/' });
        return res.end();
      }
      file = join(file, 'index.html');
      info = await stat(file);
    }
    const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'content-length': info.size,
      'cache-control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  } catch {
    notFound(res);
  }
}

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://local');
  if (pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    // Render sets RENDER_GIT_COMMIT, which shows which version is live.
    return res.end(`ok ${(process.env.RENDER_GIT_COMMIT || 'dev').slice(0, 7)}`);
  }
  if (pathname === '/config.json') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
    return res.end(JSON.stringify({ gostopUrl: GOSTOP_URL, classicubeClient: process.env.CLASSICUBE_CLIENT_URL || undefined }));
  }
  if (pathname === '/api/gostop/status') return handleGostop(req, res);
  if (pathname === '/api/classic/status') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(classic.status()));
  }
  if (pathname.endsWith('/static/default.zip')) {
    return serveCached(req, res, TEXTURES_URL, 'classicube-default.zip', { type: 'application/zip', max: 8 * 1024 * 1024 });
  }
  if (pathname.startsWith('/api/pc/image/')) {
    if (rateLimited(clientIp(req))) {
      res.writeHead(429, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
    }
    return handlePcImage(req, res, pathname);
  }
  if (pathname === PROXY_PATH) return handleProxy(req, res, clientIp(req));
  if (pathname.startsWith('/api/chess/')) {
    if (req.method === 'POST' && rateLimited(clientIp(req))) {
      res.writeHead(429, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }));
    }
    return handleChess(req, res, pathname);
  }
  if (pathname.startsWith('/api/balloon/')) {
    // Key presses have their own per-seat limit in balloon-online.mjs.
    if (req.method === 'POST' && !isInput(pathname) && rateLimited(clientIp(req))) {
      res.writeHead(429, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }));
    }
    return handleBalloon(req, res, pathname);
  }
  if (pathname === '/yt/search' || pathname === '/api/weather') {
    if (rateLimited(clientIp(req))) {
      res.writeHead(429, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }));
    }
    return pathname === '/yt/search' ? handleYouTube(req, res) : handleWeather(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  serveStatic(req, res, pathname);
});

// ClassiCube's web client opens wss://<host>:<port>/ with the "ClassiCube" subprotocol.
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://local');
  const wantsClassic = String(req.headers['sec-websocket-protocol'] || '').includes('ClassiCube') || pathname === '/classic';
  if (!wantsClassic) return socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
  const ws = upgrade(req, socket, head, { protocol: 'ClassiCube' });
  if (!ws) return;
  const link = classic.connect({ ip: clientIp(req), send: (b) => ws.send(b), close: () => ws.close() });
  ws.onmessage = link.receive;
  ws.onclose = link.closed;
});
if (process.env.CLASSIC_TCP_PORT) classic.listenTcp(Number(process.env.CLASSIC_TCP_PORT));

// Render sends SIGTERM before replacing the instance; keep the block world.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    await classic.save().catch(() => {});
    process.exit(0);
  });
}

server.listen(PORT, HOST, () => {
  console.log(`Win11 Web running at http://localhost:${PORT}`);
});
