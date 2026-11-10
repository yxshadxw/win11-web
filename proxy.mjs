// Web proxy used by the in-site Chrome app.
// Public deployment, so: only http(s), no private/loopback targets (checked at connect time
// to stop DNS rebinding), per-IP rate limit, size/time limits, no cookies, and every proxied
// page is sandboxed to an opaque origin so it can't touch the desktop's storage.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';
import { randomBytes } from 'node:crypto';

export const PROXY_PATH = '/proxy';
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const RATE_WINDOW_MS = 60_000;
// Page loads are limited tightly; the stylesheets, scripts, images and fonts a page pulls in
// (often 100+ per page) get a separate, much higher budget. Sharing one budget made a few page
// loads turn stylesheets into 429 HTML pages, which browsers then refuse to apply.
const RATE_MAX = 240;
export const RATE_MAX_ASSETS = 3000;
const RATE_MAX_POST = 60;
const MAX_POST_BYTES = 1024 * 1024;
// Cookie jars live in this server's memory, one per browsing session (see jarFor).
const SESSION_TTL_MS = 2 * 60 * 60_000;
const MAX_SESSIONS = 500;
const MAX_COOKIES = 100;

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

export function proxify(target, base, sid = null) {
  const value = String(target).trim();
  if (!value || /^(#|javascript:|data:|blob:|mailto:|tel:|about:)/i.test(value)) return value;
  try {
    const abs = new URL(value, base);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return value;
    return `${PROXY_PATH}?url=${encodeURIComponent(abs.href)}${sid ? `&s=${sid}` : ''}`;
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

/**
 * Browsers refuse to apply a stylesheet whose MIME type is not CSS (the proxy also sends
 * nosniff). Many sites serve CSS as text/plain or application/octet-stream, so when the browser
 * says the request is for a stylesheet, label the response as CSS. HTML error pages stay HTML.
 */
export function stylesheetType(upstreamType, fetchDest) {
  if (fetchDest !== 'style' || /text\/html|application\/xhtml/i.test(upstreamType) || /text\/css/i.test(upstreamType)) return upstreamType;
  return 'text/css; charset=utf-8';
}

/**
 * ES module static and dynamic imports with relative or root-relative specifiers resolve against
 * the module's own (proxied) URL, which lands on this server's root. Rewrite them to proxy URLs.
 */
export function rewriteModule(js, base) {
  // `from "x"`, `import "x"`, `import("x")`; not `.from("x")` calls on other objects.
  return js.replace(/((?<![.\w$])(?:from\s*|import\s*\(\s*|import\s+))(["'])(\.{0,2}\/[^"'\n\r]+)\2/g,
    (m, pre, q, u) => `${pre}${q}${proxify(u, base)}${q}`);
}

export function isScriptType(type) {
  return /(?:java|ecma)script|module/i.test(type) && !/text\/html/i.test(type);
}

/**
 * Same problem as stylesheetType, for scripts: some sites serve .js as text/plain or
 * application/octet-stream (misconfigured servers, some CDNs). With this proxy's nosniff
 * header, the browser then refuses to run a <script> whose response isn't labeled as
 * JavaScript, even though it would run fine as-is. Relabel it when the browser says the
 * request is for a script.
 */
export function scriptType(upstreamType, fetchDest) {
  if (fetchDest !== 'script' || /text\/html|application\/xhtml/i.test(upstreamType) || isScriptType(upstreamType)) return upstreamType;
  return 'text/javascript; charset=utf-8';
}

export function rewriteCss(css, base) {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => `url(${q}${proxify(u, base)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => `@import ${q}${proxify(u, base)}${q}`);
}

function injectedScript(pageUrl, sid) {
  // Runs inside the sandboxed page: keeps navigation inside the proxy and reports the URL.
  return `<script>(function(){var P=${JSON.stringify(PROXY_PATH)}+'?url=',B=${JSON.stringify(pageUrl)},S=${JSON.stringify(sid || '')};
function px(u){try{var a=new URL(u,B);if(a.protocol!=='http:'&&a.protocol!=='https:')return null;return P+encodeURIComponent(a.href)+(S?'&s='+S:'');}catch(e){return null;}}
try{parent.postMessage({type:'win11web-proxy-nav',url:B,title:document.title,sid:S},'*');}catch(e){}
addEventListener('DOMContentLoaded',function(){try{parent.postMessage({type:'win11web-proxy-nav',url:B,title:document.title,sid:S},'*');}catch(e){}});
document.addEventListener('submit',function(e){var f=e.target;if((f.method||'get').toLowerCase()!=='get')return;e.preventDefault();
var a=new URL(f.getAttribute('data-orig-action')||B,B);new FormData(f).forEach(function(v,k){if(typeof v==='string')a.searchParams.append(k,v);});
var t=px(a.href);if(t)location.href=t;},true);
var o=window.open;window.open=function(u,n,f){var t=u?px(u):null;return o.call(window,t||u,n,f);};
// Scripts, styles and data that a page builds in JavaScript (GitHub's chunks, for one) are
// addressed by URLs that never went through rewriteHtml. Route them through the proxy too.
function pxv(v){if(typeof v!=='string'||!v||v.indexOf(P)===0)return v;var t=px(v);return t||v;}
var f=window.fetch;if(f)window.fetch=function(i,n){if(typeof i==='string'||(typeof URL!=='undefined'&&i instanceof URL))i=pxv(String(i));return f.call(this,i,n);};
var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(){var a=[].slice.call(arguments);a[1]=pxv(String(a[1]));return xo.apply(this,a);};
[[HTMLScriptElement,'src'],[HTMLLinkElement,'href'],[HTMLImageElement,'src'],[HTMLIFrameElement,'src'],[HTMLSourceElement,'src'],[HTMLMediaElement,'src']].forEach(function(c){var d=Object.getOwnPropertyDescriptor(c[0].prototype,c[1]);if(!d||!d.set)return;Object.defineProperty(c[0].prototype,c[1],{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){d.set.call(this,pxv(String(v)));}});});
var sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(/^(src|href)$/i.test(String(n)))v=pxv(String(v));return sa.call(this,n,v);};
})();</script>`;
}

export function rewriteHtml(html, pageUrl, sid = null) {
  let out = html
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?(content-security-policy|x-frame-options|refresh)["']?[^>]*>/gi, '')
    .replace(/\s(integrity|nonce)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/<base\s[^>]*>/gi, '');

  // form actions keep their original target for the GET-form handler in the injected script
  out = out.replace(/(<form\b[^>]*?\saction\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, v) => {
    const orig = new URL(decodeAttr(v) || pageUrl, pageUrl).href;
    return `${pre}${q}${encodeAttr(proxify(decodeAttr(v), pageUrl, sid))}${q} data-orig-action=${q}${encodeAttr(orig)}${q}`;
  });
  out = out.replace(/(\s(?:href|src|poster|data-src|background)\s*=\s*)(["'])(.*?)\2/gi,
    (m, pre, q, v) => `${pre}${q}${encodeAttr(proxify(decodeAttr(v), pageUrl, sid))}${q}`);
  out = out.replace(/(\s(?:srcset|data-srcset)\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, v) => {
    const set = decodeAttr(v).split(',').map((part) => {
      const [u, ...rest] = part.trim().split(/\s+/);
      return [proxify(u, pageUrl, sid), ...rest].join(' ');
    }).join(', ');
    return `${pre}${q}${encodeAttr(set)}${q}`;
  });
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, b) => a + rewriteCss(css, pageUrl) + b);
  out = out.replace(/(\sstyle\s*=\s*)(["'])(.*?)\2/gi,
    (m, pre, q, v) => `${pre}${q}${encodeAttr(rewriteCss(decodeAttr(v), pageUrl))}${q}`);

  const script = injectedScript(pageUrl, sid);
  if (/<head\b[^>]*>/i.test(out)) return out.replace(/<head\b[^>]*>/i, (h) => h + script);
  return script + out;
}

const hits = new Map();
export function rateLimited(ip, now = Date.now(), max = RATE_MAX) {
  const entry = hits.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, count: 1, max });
    if (hits.size > 10_000) {
      for (const [key, e] of hits) if (now - e.start > RATE_WINDOW_MS) hits.delete(key);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > (entry.max ?? RATE_MAX);
}

// Keep-alive reuses connections (and TLS sessions) across a page's many asset requests.
// Reused sockets were opened through safeLookup, so they already passed the address check.
const agents = {
  'http:': new http.Agent({ keepAlive: true, maxSockets: 64 }),
  'https:': new https.Agent({ keepAlive: true, maxSockets: 64 }),
};

function request(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method, headers, lookup: safeLookup, timeout: TIMEOUT_MS, agent: agents[url.protocol],
    }, resolve);
    req.on('timeout', () => req.destroy(new ProxyError(504, '응답 시간이 초과되었습니다.')));
    req.on('error', reject);
    req.end(body);
  });
}

// ---------- sessions and cookies ----------
// A browsing session (one per tab) carries its cookies on the server, keyed by a random id that
// the proxy puts in every link and form as s=. Browsers would refuse third-party cookies from the
// sandboxed frame, and the cookies never reach the visitor's browser at all.
export function newSessionId() {
  return randomBytes(16).toString('hex');
}

export function validSession(value) {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value) ? value : null;
}

const jars = new Map();

function jarFor(sid) {
  let jar = jars.get(sid);
  if (!jar) {
    const now = Date.now();
    for (const [key, j] of jars) if (now - j.time > SESSION_TTL_MS) jars.delete(key);
    if (jars.size >= MAX_SESSIONS) jars.delete(jars.keys().next().value);
    jar = { time: now, cookies: new Map() };
    jars.set(sid, jar);
  }
  jar.time = Date.now();
  return jar;
}

function defaultPath(pathname) {
  return pathname.slice(0, pathname.lastIndexOf('/') + 1) || '/';
}

// Many sites build asset URLs from a script's own address or document.baseURI at runtime
// (webpack's auto public-path, for one), stripping everything from "?" on first. Since the
// page's and every script's real address is a /proxy?url=...&s=... URL, that computation lands
// the asset request on our own origin at a bare path, with the real target's whole origin lost.
// The fix needs the right origin to retarget at, which is often NOT the page's own origin: many
// sites (GitHub included) serve their scripts and styles from a separate asset/CDN host. So each
// session remembers two things: the page's own origin (docOrigin, from the document load) and
// the origin its scripts and stylesheets actually came from (assetOrigin, updated on every script
// or CSS response) -- the latter is what a script's own public-path computation most likely
// meant, and is what a misdirected request is retargeted at, falling back to docOrigin for a site
// that serves everything from one host.
export const SID_COOKIE = 'win11wsid';

export function rememberOrigin(sid, origin) {
  if (!sid) return;
  jarFor(sid).docOrigin = origin;
}

export function rememberAssetOrigin(sid, origin) {
  if (!sid) return;
  jarFor(sid).assetOrigin = origin;
}

export function recallOrigin(sid) {
  if (!sid) return null;
  const jar = jars.get(sid);
  if (!jar) return null;
  jar.time = Date.now();
  return jar.assetOrigin || jar.docOrigin || null;
}

/** The win11wsid value from a visitor's Cookie header, if any looks valid. */
export function sidFromCookieHeader(header) {
  const m = /(?:^|;\s*)win11wsid=([0-9a-f]{32})/.exec(String(header || ''));
  return m ? m[1] : null;
}

/** One Set-Cookie header, parsed for the response's host. Returns null when it is not allowed. */
export function parseSetCookie(line, url) {
  const parts = String(line).split(';');
  const eq = parts[0].indexOf('=');
  if (eq < 1) return null;
  const cookie = {
    name: parts[0].slice(0, eq).trim(), value: parts[0].slice(eq + 1).trim(),
    domain: url.hostname, hostOnly: true, path: defaultPath(url.pathname), secure: false, expires: 0, remove: false,
  };
  let maxAge = null;
  for (const raw of parts.slice(1)) {
    const cut = raw.indexOf('=');
    const key = (cut < 0 ? raw : raw.slice(0, cut)).trim().toLowerCase();
    const val = cut < 0 ? '' : raw.slice(cut + 1).trim();
    if (key === 'domain') {
      const d = val.replace(/^\./, '').toLowerCase();
      // A site may only set cookies for its own domain, never for a bare top-level domain.
      if (!d.includes('.') || !(url.hostname === d || url.hostname.endsWith(`.${d}`))) return null;
      cookie.domain = d;
      cookie.hostOnly = false;
    } else if (key === 'path' && val.startsWith('/')) cookie.path = val;
    else if (key === 'secure') cookie.secure = true;
    else if (key === 'max-age') maxAge = Number(val);
    else if (key === 'expires' && maxAge === null) {
      const t = Date.parse(val);
      if (!Number.isNaN(t)) cookie.expires = t;
    }
  }
  if (maxAge !== null && !Number.isNaN(maxAge)) cookie.expires = maxAge > 0 ? Date.now() + maxAge * 1000 : 1;
  if (cookie.expires && cookie.expires <= Date.now()) cookie.remove = true;
  return cookie;
}

export function storeCookies(sid, url, setCookies) {
  for (const line of [].concat(setCookies || [])) {
    const cookie = parseSetCookie(line, url);
    if (!cookie) continue;
    const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
    if (cookie.remove) { jars.get(sid)?.cookies.delete(key); continue; }
    const jar = jarFor(sid);
    jar.cookies.set(key, cookie);
    if (jar.cookies.size > MAX_COOKIES) jar.cookies.delete(jar.cookies.keys().next().value);
  }
}

/** The Cookie header this session sends to `url`. */
export function cookieHeader(sid, url, now = Date.now()) {
  const jar = jars.get(sid);
  if (!jar) return '';
  jar.time = now;
  const matching = [];
  for (const [key, c] of jar.cookies) {
    if (c.expires && c.expires < now) { jar.cookies.delete(key); continue; }
    const host = c.hostOnly ? url.hostname === c.domain : url.hostname === c.domain || url.hostname.endsWith(`.${c.domain}`);
    if (!host || !url.pathname.startsWith(c.path)) continue;
    if (c.secure && url.protocol !== 'https:') continue;
    matching.push(c);
  }
  matching.sort((a, b) => b.path.length - a.path.length);
  return matching.map((c) => `${c.name}=${c.value}`).join('; ');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_POST_BYTES) {
        reject(new ProxyError(413, '보내는 내용이 너무 큽니다.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
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

/** GETs a URL with the same safety checks and redirect handling as the proxy; returns decoded text. */
export async function fetchText(target) {
  let url = normalizeTarget(target);
  for (let i = 0; ; i++) {
    const upstream = await request(url, 'GET', { 'user-agent': UA, 'accept-language': 'ko-KR,ko;q=0.9', 'accept-encoding': 'gzip, deflate, br' });
    const loc = upstream.headers.location;
    if (upstream.statusCode >= 300 && upstream.statusCode < 400 && loc) {
      upstream.resume();
      if (i >= MAX_REDIRECTS) throw new ProxyError(508, '리다이렉트가 너무 많습니다.');
      url = normalizeTarget(new URL(loc, url).href);
      continue;
    }
    if (upstream.statusCode >= 400) { upstream.resume(); throw new ProxyError(502, `원본 사이트가 ${upstream.statusCode} 오류를 반환했습니다.`); }
    const body = await readLimited(decompress(upstream));
    return charsetOf(String(upstream.headers['content-type'] || '')).decode(body);
  }
}

// Small in-memory cache for static assets (images, scripts, fonts) shared by all visitors.
const ASSET_TTL_MS = 10 * 60_000;
const ASSET_MAX_ITEM = 1024 * 1024;
const ASSET_MAX_TOTAL = 64 * 1024 * 1024;
const assetCache = new Map();
let assetBytes = 0;

function cacheGet(key) {
  const hit = assetCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time > ASSET_TTL_MS) { assetCache.delete(key); assetBytes -= hit.body.length; return null; }
  assetCache.delete(key); // re-insert to mark as recently used
  assetCache.set(key, hit);
  return hit;
}

function cachePut(key, status, headers, body) {
  if (body.length > ASSET_MAX_ITEM || status !== 200) return;
  if (/no-store|private/i.test(headers['cache-control'] || '')) return;
  assetCache.set(key, { time: Date.now(), status, headers, body });
  assetBytes += body.length;
  for (const [k, v] of assetCache) {
    if (assetBytes <= ASSET_MAX_TOTAL) break;
    assetCache.delete(k);
    assetBytes -= v.body.length;
  }
}

export async function handleProxy(req, res, clientIp) {
  const sendError = (status, message) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': SANDBOX_CSP, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(errorPage(status, message));
  };
  const method = req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    return sendError(405, '이 프록시는 페이지 열기와 폼 전송(GET, POST)만 지원합니다.');
  }
  // A page load is a document request; everything else is a sub-resource of some page.
  const dest = String(req.headers['sec-fetch-dest'] || 'document');
  const isDocument = dest === 'document' || dest === 'iframe' || dest === 'frame';
  const key = method === 'POST' ? `${clientIp}|post` : isDocument ? clientIp : `${clientIp}|assets`;
  const max = method === 'POST' ? RATE_MAX_POST : isDocument ? RATE_MAX : RATE_MAX_ASSETS;
  if (rateLimited(key, Date.now(), max)) {
    return sendError(429, '요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
  }

  try {
    const params = new URL(req.url, 'http://local').searchParams;
    let url = normalizeTarget(params.get('url'));
    // Documents always get a session (their links carry it); other requests only when they have one,
    // either from their own s= (wrapped by us) or, failing that, the visitor's win11wsid cookie
    // (set below) for requests a page issued in a way we could not rewrite at all.
    const sid = validSession(params.get('s')) || sidFromCookieHeader(req.headers.cookie) || (isDocument ? newSessionId() : null);
    // A page that computes its own asset origin at runtime (document.baseURI, location.origin)
    // sometimes lands the request back on our own host instead of the real one. Recover it from
    // what we remember as this session's current page.
    const ownHost = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (sid && ownHost && url.hostname.toLowerCase() === ownHost) {
      const real = recallOrigin(sid);
      if (real) url = normalizeTarget(real + url.pathname + url.search);
    }
    let payload = method === 'POST' ? await readBody(req) : undefined;
    const cached = method === 'GET' && !sid ? cacheGet(url.href) : null;
    if (cached) {
      res.writeHead(cached.status, { ...cached.headers, 'x-proxy-cache': 'hit' });
      return res.end(cached.body);
    }
    const cacheKey = url.href;
    let upstream;
    let sendMethod = method;
    for (let i = 0; ; i++) {
      const headers = {
        'user-agent': UA,
        accept: req.headers.accept || '*/*',
        'accept-language': req.headers['accept-language'] || 'ko-KR,ko;q=0.9,en;q=0.8',
        'accept-encoding': 'gzip, deflate, br',
      };
      const cookie = sid ? cookieHeader(sid, url) : '';
      if (cookie) headers.cookie = cookie;
      if (sendMethod === 'POST') {
        headers['content-type'] = req.headers['content-type'] || 'application/x-www-form-urlencoded';
        headers['content-length'] = String(payload.length);
        headers.origin = url.origin;
        headers.referer = `${url.origin}/`;
      }
      upstream = await request(url, sendMethod, headers, payload);
      if (sid && upstream.headers['set-cookie']) storeCookies(sid, url, upstream.headers['set-cookie']);
      const loc = upstream.headers.location;
      if (upstream.statusCode >= 300 && upstream.statusCode < 400 && loc) {
        upstream.resume();
        if (i >= MAX_REDIRECTS) throw new ProxyError(508, '리다이렉트가 너무 많습니다.');
        // As in browsers: after a POST, 301-303 continue with GET; 307/308 resend the body.
        if (sendMethod === 'POST' && upstream.statusCode < 307) { sendMethod = 'GET'; payload = undefined; }
        url = normalizeTarget(new URL(loc, url).href);
        continue;
      }
      break;
    }

    const type = scriptType(
      stylesheetType(String(upstream.headers['content-type'] || ''), req.headers['sec-fetch-dest']),
      req.headers['sec-fetch-dest'],
    );
    if (sid) {
      if (isDocument) rememberOrigin(sid, url.origin);
      // Many sites serve their scripts and styles from a separate asset/CDN host, and it is
      // that host, not the page's own, that a script's own URL computation usually means.
      else if (isScriptType(type) || /text\/css/i.test(type)) rememberAssetOrigin(sid, url.origin);
    }
    const headers = {
      'content-type': type || 'application/octet-stream',
      'content-security-policy': SANDBOX_CSP,
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
      'referrer-policy': 'no-referrer',
      'cache-control': upstream.headers['cache-control'] || 'no-cache',
      'x-proxied-url': encodeURI(url.href),
    };
    // So a request a page issues without going through our rewriting (document.baseURI /
    // location.origin-based asset paths, which land on our own host with no s= at all) can
    // still be traced back to the right session and origin, via recallOrigin above.
    if (isDocument && sid) headers['set-cookie'] = `${SID_COOKIE}=${sid}; Path=/; Max-Age=7200; SameSite=None; Secure`;

    if (/text\/html|application\/xhtml/i.test(type) || /text\/css/i.test(type) || isScriptType(type)) {
      const body = await readLimited(decompress(upstream));
      const text = charsetOf(type).decode(body);
      let rewritten;
      if (isScriptType(type)) rewritten = rewriteModule(text, url.href);
      else if (/css/i.test(type) && !/html/i.test(type)) rewritten = rewriteCss(text, url.href);
      else rewritten = rewriteHtml(text, url.href, sid);
      headers['content-type'] = type.replace(/charset=[\w-]+/i, 'charset=utf-8') || 'text/html; charset=utf-8';
      res.writeHead(upstream.statusCode, headers);
      // Shared cache only for responses that do not depend on a visitor's cookies.
      if (method === 'GET' && !sid && /css/i.test(type) && !/html/i.test(type)) cachePut(cacheKey, upstream.statusCode, headers, Buffer.from(rewritten));
      return res.end(method === 'HEAD' ? undefined : rewritten);
    }

    const len = Number(upstream.headers['content-length'] || 0);
    if (len > MAX_BYTES) { upstream.resume(); throw new ProxyError(413, '파일이 너무 큽니다.'); }
    if (upstream.headers['content-encoding']) headers['content-encoding'] = upstream.headers['content-encoding'];
    if (len) headers['content-length'] = String(len);
    if (method === 'GET' && !sid && len && len <= ASSET_MAX_ITEM && upstream.statusCode === 200) {
      const body = await readLimited(upstream); // still compressed: stored and sent as-is
      cachePut(cacheKey, 200, headers, body);
      res.writeHead(200, headers);
      return res.end(body);
    }
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
