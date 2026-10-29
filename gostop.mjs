// Health check for the separately deployed gostop-next (hwatu-club) server. A browser can't
// see why a cross-origin iframe fails, but the server can: not configured, asleep, refusing
// to be framed, or plain http on an https page. /api/gostop/status reports which one.
const DEFAULT_URL = 'http://localhost:3000';
const TIMEOUT_MS = 25_000;
const CACHE_MS = 15_000;
let cached = null;

export function gostopTarget(env = process.env) {
  const raw = (env.GOSTOP_URL || '').trim();
  return { url: raw || DEFAULT_URL, configured: Boolean(raw) };
}

/** Does a response forbid being shown in an iframe on another site? */
export function frameBlocked(headers) {
  const xfo = String(headers.get('x-frame-options') || '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return true;
  const csp = String(headers.get('content-security-policy') || '');
  const ancestors = /frame-ancestors([^;]*)/i.exec(csp)?.[1].trim();
  if (!ancestors) return false;
  return !ancestors.split(/\s+/).some((s) => s === '*' || s === 'https:');
}

export async function probe(target, fetchImpl = fetch) {
  const { url, configured } = target;
  const result = { url, configured, reachable: false, status: 0, frameBlocked: false, reason: '' };
  if (!configured && process.env.NODE_ENV === 'production') {
    result.reason = 'not-configured';
    return result;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': 'win11-web gostop check' } });
    result.status = res.status;
    result.reachable = res.status < 500;
    result.frameBlocked = frameBlocked(res.headers);
    // Render answers 502/503 while a sleeping free instance boots.
    result.reason = res.status >= 500 ? 'starting' : result.frameBlocked ? 'frame-blocked' : 'ok';
    res.body?.cancel?.();
  } catch (err) {
    result.reason = err.name === 'AbortError' ? 'timeout' : 'unreachable';
  } finally {
    clearTimeout(timer);
  }
  return result;
}

export async function handleGostop(req, res) {
  const now = Date.now();
  if (!cached || now - cached.at > CACHE_MS) cached = { at: now, value: probe(gostopTarget()) };
  let body;
  try { body = await cached.value; } catch { body = { reason: 'unreachable' }; }
  // Don't keep a failure around: the next check should try again.
  if (body.reason !== 'ok') cached.at = Math.min(cached.at, now - CACHE_MS + 3000);
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
