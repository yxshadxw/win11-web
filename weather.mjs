// Weather for the Weather app and the desktop widgets: a cached pass-through to Open-Meteo
// (free, no API key). Coordinates are rounded so nearby requests share a cache entry.
import { fetchText, ProxyError } from './proxy.mjs';

const CACHE_MS = 10 * 60_000;
const cache = new Map();

const PARAMS = {
  current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
  hourly: 'temperature_2m,weather_code,precipitation_probability',
  daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max',
  forecast_days: '7',
  forecast_hours: '48',
  timezone: 'auto',
};

export function parseCoords(search) {
  const p = new URLSearchParams(search);
  const lat = Number(p.get('lat'));
  const lon = Number(p.get('lon'));
  if (!p.has('lat') || !p.has('lon') || !Number.isFinite(lat) || !Number.isFinite(lon)
    || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new ProxyError(400, '위치 좌표가 올바르지 않습니다.');
  }
  return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
}

export async function getWeather({ lat, lon }) {
  const key = `${lat},${lon}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < CACHE_MS) return hit.body;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({ latitude: String(lat), longitude: String(lon), ...PARAMS }).toString();
  const body = await fetchText(url.href);
  JSON.parse(body); // make sure upstream returned JSON before caching it
  cache.set(key, { time: Date.now(), body });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return body;
}

export async function handleWeather(req, res) {
  try {
    const body = await getWeather(parseCoords(new URL(req.url, 'http://local').search));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' });
    res.end(body);
  } catch (err) {
    const status = err instanceof ProxyError ? err.status : 502;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err instanceof ProxyError ? err.message : '날씨 정보를 가져오지 못했습니다.' }));
  }
}
