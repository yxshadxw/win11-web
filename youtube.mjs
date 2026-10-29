// YouTube search for the in-site Chrome app. YouTube renders its pages with JavaScript, which the
// rewriting proxy can't relay, so the server reads the search results embedded in the page
// (ytInitialData) and the app plays videos through YouTube's own embed player.
import { fetchText, ProxyError } from './proxy.mjs';

const CACHE_MS = 10 * 60_000;
const cache = new Map();

/** Pulls the JSON object that follows `var ytInitialData =` out of a results page. */
export function extractInitialData(html) {
  const marker = html.indexOf('ytInitialData = ');
  if (marker === -1) return null;
  const start = html.indexOf('{', marker);
  const end = html.indexOf(';</script>', start);
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(html.slice(start, end)); } catch { return null; }
}

const text = (node) => node?.simpleText ?? node?.runs?.map((r) => r.text).join('') ?? '';

/** Collects every videoRenderer in the data tree, in page order. */
export function parseResults(data, limit = 30) {
  const videos = [];
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || videos.length >= limit) return;
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    const v = node.videoRenderer;
    if (v?.videoId && !seen.has(v.videoId)) {
      seen.add(v.videoId);
      videos.push({
        id: v.videoId,
        title: text(v.title),
        channel: text(v.ownerText),
        length: text(v.lengthText),
        views: text(v.shortViewCountText) || text(v.viewCountText),
        published: text(v.publishedTimeText),
        live: !v.lengthText && Boolean(v.badges?.length),
      });
    }
    for (const key of Object.keys(node)) walk(node[key]);
  };
  walk(data);
  return videos;
}

export async function searchYouTube(query) {
  const q = String(query || '').trim().slice(0, 120);
  if (!q) throw new ProxyError(400, '검색어가 비어 있습니다.');
  const hit = cache.get(q);
  if (hit && Date.now() - hit.time < CACHE_MS) return hit.videos;
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=ko&gl=KR`;
  const html = await fetchText(url);
  const data = extractInitialData(html);
  if (!data) throw new ProxyError(502, 'YouTube 검색 결과를 읽지 못했습니다.');
  const videos = parseResults(data);
  cache.set(q, { time: Date.now(), videos });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return videos;
}

export async function handleYouTube(req, res) {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  try {
    const q = new URL(req.url, 'http://local').searchParams.get('q');
    send(200, { videos: await searchYouTube(q) });
  } catch (err) {
    send(err instanceof ProxyError ? err.status : 502, { error: err instanceof ProxyError ? err.message : 'YouTube에 연결하지 못했습니다.' });
  }
}
