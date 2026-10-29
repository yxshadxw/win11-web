// Web proxy used by the in-site Chrome app.
// Public deployment, so: only http(s), no private/loopback targets (checked at connect time
// to stop DNS rebinding), per-IP rate limit, size/time limits, no cookies, and every proxied
// page is sandboxed to an opaque origin so it can't touch the desktop's storage.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';

export const PROXY_PATH = '/proxy';
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 240;

const SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export class ProxyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const BLOCKED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [ipv4ToInt(base), bits]);

export function isBlockedAddress(ip) {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return BLOCKED_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (base & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const b = ipv6Bytes(ip);
    if (!b) return true;
    const zero = (from, to) => b.slice(from, to).every((x) => x === 0);
    const v4 = () => `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
    // Forms that embed an IPv4 address, in any spelling (::ffff:7f00:1, ::ffff:127.0.0.1, ...):
    if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return isBlockedAddress(v4()); // ::ffff:0:0/96 mapped
    if (zero(0, 12)) return isBlockedAddress(v4());                                     // ::/96 compatible, ::, ::1
    if (zero(0, 8) && b[8] === 0xff && b[9] === 0xff && zero(10, 12)) return true;      // ::ffff:0:0:0/96 SIIT
    if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true;  // 64:ff9b::/32 NAT64
    if (b[0] === 0x20 && b[1] === 0x02) return true;                                    // 2002::/16 6to4
    if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return true;        // 2001::/32 Teredo
    if ((b[0] & 0xfe) === 0xfc) return true;                                            // fc00::/7 unique local
    if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;                           // fe80::/10 link local
    if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true;                           // fec0::/10 site local
    if (b[0] === 0xff) return true;                                                     // multicast
    return false;
  }
  return true;
}

/** Parses any valid IPv6 spelling (compressed, zone id, dotted IPv4 tail) into 16 bytes. */
function ipv6Bytes(ip) {
  let s = ip.toLowerCase().replace(/%.*$/, '');
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const p = tail[1].split('.').map(Number);
    s = s.slice(0, -tail[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  const groups = [...head, ...Array(fill).fill('0'), ...rest];
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const g of groups) {
    const n = parseInt(g, 16);
    if (!/^[0-9a-f]{1,4}$/.test(g) || Number.isNaN(n)) return null;
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes;
}

export function normalizeTarget(raw) {
  let input = String(raw || '').trim();
  if (!input) throw new ProxyError(400, '주소가 비어 있습니다.');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(input)) input = `https://${input}`;
  let url;
  try { url = new URL(input); } catch { throw new ProxyError(400, '올바른 주소가 아닙니다.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProxyError(400, 'http, https 주소만 열 수 있습니다.');
  }
  if (url.username || url.password) throw new ProxyError(400, '계정 정보가 포함된 주소는 열 수 없습니다.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new ProxyError(403, '내부 주소는 열 수 없습니다.');
  }
  if (net.isIP(host) && isBlockedAddress(host)) throw new ProxyError(403, '내부 주소는 열 수 없습니다.');
  url.hash = '';
  return url;
}

// dns.lookup replacement handed to http.request: the socket connects to exactly the
// addresses we validated here.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    if (!list.length || list.some((a) => isBlockedAddress(a.address))) {
      return callback(new ProxyError(403, '내부 주소는 열 수 없습니다.'));
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export function proxify(target, base) {
  const value = String(target).trim();
  if (!value || /^(#|javascript:|data:|blob:|mailto:|tel:|about:)/i.test(value)) return value;
  try {
    const abs = new URL(value, base);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return value;
    return `${PROXY_PATH}?url=${encodeURIComponent(abs.href)}`;
  } catch {
    return value;
  }
}

function decodeAttr(v) {
  return v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function encodeAttr(v) {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function rewriteCss(css, base) {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => `url(${q}${proxify(u, base)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => `@import ${q}${proxify(u, base)}${q}`);
}

function injectedScript(pageUrl) {
  // Runs inside the sandboxed page: keeps navigation inside the proxy and reports the URL.
  return `<script>(function(){var P=${JSON.stringify(PROXY_PATH)}+'?url=',B=${JSON.stringify(pageUrl)};
function px(u){try{var a=new URL(u,B);if(a.protocol!=='http:'&&a.protocol!=='https:')return null;return P+encodeURIComponent(a.href);}catch(e){return null;}}
try{parent.postMessage({type:'win11web-proxy-nav',url:B,title:document.title},'*');}catch(e){}
addEventListener('DOMContentLoaded',function(){try{parent.postMessage({type:'win11web-proxy-nav',url:B,title:document.title},'*');}catch(e){}});
document.addEventListener('submit',function(e){var f=e.target;if((f.method||'get').toLowerCase()!=='get')return;e.preventDefault();
var a=new URL(f.getAttribute('data-orig-action')||B,B);new FormData(f).forEach(function(v,k){if(typeof v==='string')a.searchParams.append(k,v);});
var t=px(a.href);if(t)location.href=t;},true);
var o=window.open;window.open=function(u,n,f){var t=u?px(u):null;return o.call(window,t||u,n,f);};})();</script>`;
}

export function rewriteHtml(html, pageUrl) {
  let out = html
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?(content-security-policy|x-frame-options|refresh)["']?[^>]*>/gi, '')
    .replace(/\s(integrity|nonce)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/<base\s[^>]*>/gi, '');

  // form actions keep their original target for the GET-form handler in the injected script
  out = out.replace(/(<form\b[^>]*?\saction\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, v) => {
    const orig = new URL(decodeAttr(v) || pageUrl, pageUrl).href;
    return `${pre}${q}${encodeAttr(proxify(decodeAttr(v), pageUrl))}${q} data-orig-action=${q}${encodeAttr(orig)}${q}`;
  });
  out = out.replace(/(\s(?:href|src|poster|data-src|background)\s*=\s*)(["'])(.*?)\2/gi,
    (m, pre, q, v) => `${pre}${q}${encodeAttr(proxify(decodeAttr(v), pageUrl))}${q}`);
  out = out.replace(/(\s(?:srcset|data-srcset)\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, v) => {
    const set = decodeAttr(v).split(',').map((part) => {
      const [u, ...rest] = part.trim().split(/\s+/);
      return [proxify(u, pageUrl), ...rest].join(' ');
    }).join(', ');
    return `${pre}${q}${encodeAttr(set)}${q}`;
  });
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, b) => a + rewriteCss(css, pageUrl) + b);
  out = out.replace(/(\sstyle\s*=\s*)(["'])(.*?)\2/gi,
    (m, pre, q, v) => `${pre}${q}${encodeAttr(rewriteCss(decodeAttr(v), pageUrl))}${q}`);

  const script = injectedScript(pageUrl);
  if (/<head\b[^>]*>/i.test(out)) return out.replace(/<head\b[^>]*>/i, (h) => h + script);
  return script + out;
}

const hits = new Map();
export function rateLimited(ip, now = Date.now()) {
  const entry = hits.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    if (hits.size > 10_000) {
      for (const [key, e] of hits) if (now - e.start > RATE_WINDOW_MS) hits.delete(key);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX;
}

function request(url, method, headers) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, { method, headers, lookup: safeLookup, timeout: TIMEOUT_MS }, resolve);
    req.on('timeout', () => req.destroy(new ProxyError(504, '응답 시간이 초과되었습니다.')));
    req.on('error', reject);
    req.end();
  });
}

function decompress(res) {
  const enc = String(res.headers['content-encoding'] || '').toLowerCase();
  if (enc === 'gzip' || enc === 'x-gzip') return res.pipe(zlib.createGunzip());
  if (enc === 'deflate') return res.pipe(zlib.createInflate());
  if (enc === 'br') return res.pipe(zlib.createBrotliDecompress());
  return res;
}

async function readLimited(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new ProxyError(413, '페이지가 너무 큽니다.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function charsetOf(type) {
  const m = /charset=([\w-]+)/i.exec(type);
  try { return new TextDecoder(m ? m[1] : 'utf-8'); } catch { return new TextDecoder('utf-8'); }
}

export function errorPage(status, message) {
  const safe = String(message).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><meta charset="utf-8"><title>열 수 없음</title>
<style>body{font-family:"Segoe UI","Malgun Gothic",sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f3f3f3;color:#1b1b1b}
@media(prefers-color-scheme:dark){body{background:#202020;color:#fff}}div{max-width:420px;text-align:center}h1{font-size:20px;font-weight:600}</style>
<div><h1>이 페이지를 열 수 없습니다</h1><p>${safe}</p><p style="opacity:.7">코드 ${status}</p></div>`;
}

export async function handleProxy(req, res, clientIp) {
  const sendError = (status, message) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': SANDBOX_CSP, 'cache-control': 'no-store' });
    res.end(errorPage(status, message));
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(405, '이 프록시는 페이지 열기(GET)만 지원합니다.');
  if (rateLimited(clientIp)) return sendError(429, '요청이 너무 많습니다. 잠시 후 다시 시도하세요.');

  try {
    const params = new URL(req.url, 'http://local').searchParams;
    let url = normalizeTarget(params.get('url'));
    let upstream;
    for (let i = 0; ; i++) {
      upstream = await request(url, req.method, {
        'user-agent': UA,
        accept: req.headers.accept || '*/*',
        'accept-language': req.headers['accept-language'] || 'ko-KR,ko;q=0.9,en;q=0.8',
        'accept-encoding': 'gzip, deflate, br',
      });
      const loc = upstream.headers.location;
      if (upstream.statusCode >= 300 && upstream.statusCode < 400 && loc) {
        upstream.resume();
        if (i >= MAX_REDIRECTS) throw new ProxyError(508, '리다이렉트가 너무 많습니다.');
        url = normalizeTarget(new URL(loc, url).href);
        continue;
      }
      break;
    }

    const type = String(upstream.headers['content-type'] || '');
    const headers = {
      'content-type': type || 'application/octet-stream',
      'content-security-policy': SANDBOX_CSP,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': upstream.headers['cache-control'] || 'no-cache',
      'x-proxied-url': encodeURI(url.href),
    };

    if (/text\/html|application\/xhtml/i.test(type) || /text\/css/i.test(type)) {
      const body = await readLimited(decompress(upstream));
      const text = charsetOf(type).decode(body);
      const rewritten = /css/i.test(type) && !/html/i.test(type) ? rewriteCss(text, url.href) : rewriteHtml(text, url.href);
      headers['content-type'] = type.replace(/charset=[\w-]+/i, 'charset=utf-8') || 'text/html; charset=utf-8';
      res.writeHead(upstream.statusCode, headers);
      return res.end(req.method === 'HEAD' ? undefined : rewritten);
    }

    const len = Number(upstream.headers['content-length'] || 0);
    if (len > MAX_BYTES) { upstream.resume(); throw new ProxyError(413, '파일이 너무 큽니다.'); }
    if (upstream.headers['content-encoding']) headers['content-encoding'] = upstream.headers['content-encoding'];
    if (len) headers['content-length'] = String(len);
    res.writeHead(upstream.statusCode, headers);
    let sent = 0;
    upstream.on('data', (chunk) => {
      sent += chunk.length;
      if (sent > MAX_BYTES) { upstream.destroy(); res.destroy(); }
    });
    upstream.pipe(res);
  } catch (err) {
    if (res.headersSent) return res.destroy();
    if (err instanceof ProxyError) return sendError(err.status, err.message);
    const message = err.code === 'ENOTFOUND' ? '사이트 주소를 찾을 수 없습니다.' : '사이트에 연결하지 못했습니다.';
    sendError(502, message);
  }
}
