import { weatherInfo } from './rules.js';

const cities = [
  ['서울', 37.57, 126.98], ['부산', 35.18, 129.08], ['인천', 37.46, 126.71], ['대구', 35.87, 128.60],
  ['대전', 36.35, 127.38], ['광주', 35.16, 126.85], ['울산', 35.54, 129.31], ['세종', 36.48, 127.29],
  ['수원', 37.26, 127.03], ['제주', 33.50, 126.53], ['춘천', 37.88, 127.73], ['강릉', 37.75, 128.88],
  ['전주', 35.82, 127.15], ['청주', 36.64, 127.49], ['포항', 36.02, 129.34], ['여수', 34.76, 127.66],
  ['도쿄', 35.68, 139.69], ['오사카', 34.69, 135.50], ['베이징', 39.90, 116.41], ['상하이', 31.23, 121.47],
  ['타이베이', 25.03, 121.57], ['홍콩', 22.32, 114.17], ['방콕', 13.76, 100.50], ['싱가포르', 1.35, 103.82],
  ['런던', 51.51, -0.13], ['파리', 48.86, 2.35], ['로마', 41.90, 12.50], ['뉴욕', 40.71, -74.01],
  ['로스앤젤레스', 34.05, -118.24], ['시드니', -33.87, 151.21], ['밴쿠버', 49.28, -123.12]
].map(([name, lat, lon]) => ({ name, lat, lon }));

const main = document.querySelector('#main');
const picker = document.querySelector('#picker');
const search = document.querySelector('#city-search');
const savedList = document.querySelector('#saved');
const cityList = document.querySelector('#cities');
let saved = read('saved', ['서울']);
if (!Array.isArray(saved)) saved = ['서울'];
let selected = read('selected', cities[0]);
if (!selected || typeof selected.name !== 'string' || !Number.isFinite(selected.lat) || !Number.isFinite(selected.lon)) selected = cities[0];
let requestId = 0;

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(`win11web.weather.${key}`)) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(`win11web.weather.${key}`, JSON.stringify(value)); } catch { /* Storage can be unavailable. */ }
}
function escapeText(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function temp(value) { return Number.isFinite(value) ? `${Math.round(value)}°` : '–'; }
function number(value, unit) { return Number.isFinite(value) ? `${Math.round(value)}${unit}` : '–'; }
function time(value) { return typeof value === 'string' && value.includes('T') ? value.split('T')[1].slice(0, 5) : '–'; }
function day(value, index) {
  if (index === 0) return '오늘';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '–' : new Intl.DateTimeFormat('ko-KR', { weekday: 'long' }).format(date);
}

function art(code, isDay = true, small = false) {
  const group = weatherInfo(code).group;
  return `<svg class="weather-art ${small ? 'small' : ''} ${group} ${isDay ? 'day' : 'night'}" viewBox="0 0 120 100" aria-hidden="true">
    <circle class="sun" cx="73" cy="34" r="21"/><path class="moon" d="M82 13a22 22 0 1 0 20 31A22 22 0 0 1 82 13z"/>
    <path class="cloud back" d="M22 71a19 19 0 0 1 2-38 26 26 0 0 1 48-3 19 19 0 0 1 9 38z"/>
    <path class="cloud front" d="M26 76a15 15 0 0 1 2-30 21 21 0 0 1 39-3 16 16 0 0 1 7 33z"/>
    <g class="drops"><path d="M37 80l-5 10m22-10-5 10m22-10-5 10"/></g>
    <g class="flakes"><path d="M33 81v10m-5-5h10m15-5v10m-5-5h10m15-5v10m-5-5h10"/></g>
    <path class="bolt" d="M56 70 45 88h10l-3 10 18-22H59l4-6z"/>
    <g class="mist"><path d="M20 78h58M27 86h58M36 94h42"/></g>
  </svg>`;
}

function cityButton(city, removable = false) {
  const row = document.createElement('div');
  row.className = 'city-row';
  const button = document.createElement('button');
  button.className = 'city-choice';
  button.textContent = city.name;
  button.addEventListener('click', () => {
    selected = city;
    if (!saved.includes(city.name)) saved.push(city.name);
    write('saved', saved); write('selected', selected);
    picker.close(); load();
  });
  row.append(button);
  if (removable) {
    const remove = document.createElement('button');
    remove.className = 'remove-city';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', `${city.name} 저장 해제`);
    remove.addEventListener('click', () => { saved = saved.filter(name => name !== city.name); write('saved', saved); renderCities(); });
    row.append(remove);
  }
  return row;
}
function renderCities() {
  savedList.replaceChildren(); cityList.replaceChildren();
  const favorites = cities.filter(city => saved.includes(city.name));
  if (!favorites.length) savedList.innerHTML = '<p class="muted">저장된 도시가 없습니다.</p>';
  favorites.forEach(city => savedList.append(cityButton(city, true)));
  const matches = cities.filter(city => city.name.toLowerCase().includes(search.value.trim().toLowerCase()));
  matches.forEach(city => cityList.append(cityButton(city)));
  if (!matches.length) cityList.innerHTML = '<p class="muted">검색 결과가 없습니다.</p>';
}
document.querySelector('#picker-open').addEventListener('click', () => { renderCities(); picker.showModal(); search.focus(); });
document.querySelector('#picker-close').addEventListener('click', () => picker.close());
search.addEventListener('input', renderCities);
document.querySelector('#locate').addEventListener('click', () => {
  if (!navigator.geolocation) return showError('이 브라우저에서는 현재 위치를 사용할 수 없습니다.');
  main.innerHTML = '<div class="skeleton" aria-label="현재 위치를 확인하는 중"><div></div><div></div><div></div></div>';
  navigator.geolocation.getCurrentPosition(position => {
    selected = { name: '현재 위치', lat: position.coords.latitude, lon: position.coords.longitude };
    write('selected', selected); load();
  }, error => showError(error.code === 1 ? '위치 접근이 거부되었습니다. 도시를 선택하거나 위치 권한을 허용해 주세요.' : '현재 위치를 확인하지 못했습니다. 도시를 선택해 주세요.'), { timeout: 10000 });
});

function showError(message) {
  requestId++;
  main.innerHTML = `<section class="error card"><div class="error-icon">☁</div><h2>날씨를 불러올 수 없어요</h2><p>${escapeText(message)}</p><button class="btn primary" id="retry">다시 시도</button></section>`;
  document.querySelector('#retry').addEventListener('click', load);
}
async function load() {
  const id = ++requestId;
  main.innerHTML = '<div class="skeleton" aria-label="날씨를 불러오는 중"><div></div><div></div><div></div></div>';
  try {
    const response = await fetch(`/api/weather?lat=${encodeURIComponent(selected.lat)}&lon=${encodeURIComponent(selected.lon)}`);
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || '잠시 후 다시 시도해 주세요.');
    if (!data.current || !data.hourly || !data.daily) throw new Error('예보 데이터가 올바르지 않습니다.');
    if (id === requestId) render(data);
  } catch (error) {
    if (id === requestId) showError(error.message || '잠시 후 다시 시도해 주세요.');
  }
}
function render(data) {
  const current = data.current, hourly = data.hourly, daily = data.daily;
  const info = weatherInfo(current.weather_code);
  const isDay = current.is_day !== 0;
  const currentHour = typeof current.time === 'string' ? current.time.slice(0, 13) : '';
  let start = (hourly.time || []).findIndex(value => value.slice(0, 13) === currentHour);
  if (start < 0) start = 0;
  const hours = (hourly.time || []).slice(start, start + 24);
  const values = hours.map((_, index) => hourly.temperature_2m?.[start + index]);
  const valid = values.filter(Number.isFinite);
  const low = valid.length ? Math.min(...valid) : 0, high = valid.length ? Math.max(...valid) : 1;
  const points = values.map((value, index) => `${index * 80 + 40},${Number.isFinite(value) ? 54 - (value - low) / (high - low || 1) * 34 : 54}`).join(' ');
  const allMin = (daily.temperature_2m_min || []).filter(Number.isFinite), allMax = (daily.temperature_2m_max || []).filter(Number.isFinite);
  const weekLow = allMin.length ? Math.min(...allMin) : 0, weekHigh = allMax.length ? Math.max(...allMax) : 1;
  const range = weekHigh - weekLow || 1;
  main.dataset.condition = info.group;
  main.dataset.period = isDay ? 'day' : 'night';
  main.innerHTML = `<div class="content">
    <section class="hero"><div class="hero-copy"><div class="eyebrow">현재 날씨 <span>·</span> ${isDay ? '낮' : '밤'}</div><h1>${escapeText(selected.name)}</h1><div class="current-temp">${temp(current.temperature_2m)}</div><div class="condition">${info.label}</div><p>최고 ${temp(daily.temperature_2m_max?.[0])} <span>·</span> 최저 ${temp(daily.temperature_2m_min?.[0])}</p></div><div class="hero-art">${art(current.weather_code, isDay)}</div></section>
    <section class="panel hourly"><div class="section-head"><div><div class="eyebrow">앞으로의 날씨</div><h2>시간별 예보</h2></div><span>24시간</span></div><div class="hour-scroll"><div class="hour-content" style="width:${hours.length * 80}px"><div class="hour-grid">${hours.map((value, index) => `<div class="hour"><span>${index === 0 ? '지금' : time(value)}</span>${art(hourly.weather_code?.[start + index], isDay, true)}<strong>${temp(values[index])}</strong><small>${number(hourly.precipitation_probability?.[start + index], '%')}</small></div>`).join('')}</div><svg class="chart" viewBox="0 0 ${Math.max(hours.length * 80, 1)} 64" preserveAspectRatio="none" aria-label="시간별 기온 변화"><polyline points="${points}"/></svg></div></div></section>
    <div class="lower"><section class="panel forecast"><div class="section-head"><div><div class="eyebrow">한 주 미리 보기</div><h2>7일 예보</h2></div></div><div class="forecast-list">${(daily.time || []).slice(0, 7).map((value, index) => { const min = daily.temperature_2m_min?.[index], max = daily.temperature_2m_max?.[index]; const left = Number.isFinite(min) ? Math.max(0, (min - weekLow) / range * 100) : 0; const width = Number.isFinite(min) && Number.isFinite(max) ? Math.max(2, (max - min) / range * 100) : 0; return `<div class="forecast-row"><strong>${day(value, index)}</strong><span class="forecast-icon">${art(daily.weather_code?.[index], true, true)}<small>${number(daily.precipitation_probability_max?.[index], '%')}</small></span><span class="min">${temp(min)}</span><span class="range"><i style="left:${left}%;width:${width}%"></i></span><b>${temp(max)}</b></div>`; }).join('')}</div></section>
    <section class="details"><div class="section-head"><div><div class="eyebrow">오늘의 정보</div><h2>날씨 자세히 보기</h2></div></div><div class="detail-grid"><article class="detail card"><span>◉ &nbsp;체감 온도</span><strong>${temp(current.apparent_temperature)}</strong><small>현재 체감하는 온도</small></article><article class="detail card"><span>♧ &nbsp;습도</span><strong>${number(current.relative_humidity_2m, '%')}</strong><small>상대 습도</small></article><article class="detail card"><span>≋ &nbsp;바람</span><strong>${number(current.wind_speed_10m, ' km/h')}</strong><small>현재 풍속</small></article><article class="detail card"><span>☼ &nbsp;일출 / 일몰</span><strong class="sun-times">${time(daily.sunrise?.[0])} <em>/</em> ${time(daily.sunset?.[0])}</strong><small>오늘의 해</small></article><article class="detail card"><span>♢ &nbsp;강수 확률</span><strong>${number(daily.precipitation_probability_max?.[0], '%')}</strong><small>오늘의 최대 확률</small></article></div></section></div>
    <footer>날씨 데이터: Open-Meteo · 현지 시간 기준</footer></div>`;
}
load();
