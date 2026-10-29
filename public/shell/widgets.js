// Widgets board (left flyout) and the weather chip at the left end of the taskbar.
import { $, appIcon, store } from './util.js';

const CITY_KEY = 'win11web.widgets.city';
const NOTE_KEY = 'win11web.widgets.note';
const CITIES = [
  { name: '서울', lat: 37.57, lon: 126.98 }, { name: '부산', lat: 35.18, lon: 129.08 },
  { name: '인천', lat: 37.46, lon: 126.71 }, { name: '대구', lat: 35.87, lon: 128.6 },
  { name: '대전', lat: 36.35, lon: 127.38 }, { name: '광주', lat: 35.16, lon: 126.85 },
  { name: '제주', lat: 33.5, lon: 126.53 }, { name: '도쿄', lat: 35.68, lon: 139.69 },
  { name: '뉴욕', lat: 40.71, lon: -74.01 }, { name: '런던', lat: 51.51, lon: -0.13 },
];

/** WMO weather code → [label, emoji for day, emoji for night]. */
export function describeWeather(code, isDay = 1) {
  const table = [
    [[0], '맑음', '☀️', '🌙'], [[1], '대체로 맑음', '🌤️', '🌙'], [[2], '구름 조금', '⛅', '☁️'], [[3], '흐림', '☁️', '☁️'],
    [[45, 48], '안개', '🌫️', '🌫️'], [[51, 53, 55, 56, 57], '이슬비', '🌦️', '🌧️'],
    [[61, 63, 65, 66, 67, 80, 81, 82], '비', '🌧️', '🌧️'], [[71, 73, 75, 77, 85, 86], '눈', '🌨️', '🌨️'],
    [[95, 96, 99], '뇌우', '⛈️', '⛈️'],
  ];
  const row = table.find(([codes]) => codes.includes(code)) || [[], '알 수 없음', '🌡️', '🌡️'];
  return { label: row[1], emoji: isDay ? row[2] : row[3] };
}

export class Widgets {
  constructor({ apps, openApp }) {
    this.apps = apps;
    this.openApp = openApp;
    this.panel = $('#widgets');
    this.city = CITIES.find((c) => c.name === store.get(CITY_KEY, '서울')) || CITIES[0];
    this.weather = null;

    $('#widget-btn').addEventListener('click', () => this.toggle());
    this.panel.addEventListener('click', (e) => {
      const id = e.target.closest('[data-open]')?.dataset.open;
      if (id) { this.close(); this.openApp(id); }
    });
    const select = $('#wg-city');
    select.replaceChildren(...CITIES.map((c) => Object.assign(document.createElement('option'), { value: c.name, textContent: c.name })));
    select.value = this.city.name;
    select.addEventListener('change', () => {
      this.city = CITIES.find((c) => c.name === select.value) || CITIES[0];
      store.set(CITY_KEY, this.city.name);
      this.loadWeather();
    });
    const note = $('#wg-note');
    note.value = store.get(NOTE_KEY, '');
    note.addEventListener('input', () => store.set(NOTE_KEY, note.value));

    this.loadWeather();
    setInterval(() => this.loadWeather(), 15 * 60_000);
  }

  get open() { return !this.panel.hidden; }

  toggle() {
    if (this.open) return this.close();
    this.panel.hidden = false;
    $('#widget-btn').setAttribute('aria-expanded', 'true');
    this.renderGreeting();
    this.renderPicks();
  }

  close() {
    this.panel.hidden = true;
    $('#widget-btn').setAttribute('aria-expanded', 'false');
  }

  renderGreeting() {
    const h = new Date().getHours();
    const greet = h < 6 ? '늦은 밤이에요' : h < 12 ? '좋은 아침이에요' : h < 18 ? '좋은 오후예요' : '좋은 저녁이에요';
    $('#wg-greet').textContent = greet;
    $('#wg-date').textContent = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
  }

  /** Three games picked by day, so the suggestions change daily but not on every open. */
  renderPicks() {
    const games = this.apps.filter((a) => a.category === '게임');
    const day = Math.floor(Date.now() / 86_400_000);
    const picks = [0, 1, 2].map((i) => games[(day * 7 + i * 5) % games.length]).filter((g, i, arr) => arr.indexOf(g) === i);
    $('#wg-picks').replaceChildren(...picks.map((app) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wg-pick';
      btn.dataset.open = app.id;
      btn.append(appIcon(app, 36), Object.assign(document.createElement('span'), { textContent: app.name }));
      return btn;
    }));
  }

  async loadWeather() {
    try {
      const res = await fetch(`/api/weather?lat=${this.city.lat}&lon=${this.city.lon}`);
      if (!res.ok) throw new Error();
      this.weather = await res.json();
      this.renderWeather();
    } catch {
      $('#wg-weather-body').textContent = '날씨를 불러오지 못했습니다.';
      $('#widget-btn').querySelector('.wg-chip-text').textContent = '날씨';
    }
  }

  renderWeather() {
    const cur = this.weather.current;
    const d = describeWeather(cur.weather_code, cur.is_day);
    const temp = Math.round(cur.temperature_2m);
    const chip = $('#widget-btn');
    chip.querySelector('.wg-chip-icon').textContent = d.emoji;
    chip.querySelector('.wg-chip-text').textContent = `${temp}°`;
    chip.title = `${this.city.name} ${temp}° ${d.label}`;

    const daily = this.weather.daily;
    const days = daily.time.slice(0, 5).map((t, i) => {
      const dd = describeWeather(daily.weather_code[i], 1);
      const label = i === 0 ? '오늘' : new Date(t).toLocaleDateString('ko-KR', { weekday: 'short' });
      const cell = document.createElement('div');
      cell.className = 'wg-day';
      cell.append(
        Object.assign(document.createElement('span'), { textContent: label }),
        Object.assign(document.createElement('span'), { className: 'wg-day-icon', textContent: dd.emoji, title: dd.label }),
        Object.assign(document.createElement('span'), { textContent: `${Math.round(daily.temperature_2m_max[i])}° / ${Math.round(daily.temperature_2m_min[i])}°` }),
      );
      return cell;
    });
    const now = document.createElement('div');
    now.className = 'wg-now';
    now.append(
      Object.assign(document.createElement('span'), { className: 'wg-now-icon', textContent: d.emoji }),
      Object.assign(document.createElement('span'), { className: 'wg-now-temp', textContent: `${temp}°` }),
      Object.assign(document.createElement('span'), {
        className: 'wg-now-desc',
        textContent: `${d.label} · 체감 ${Math.round(cur.apparent_temperature)}° · 습도 ${cur.relative_humidity_2m}%`,
      }),
    );
    $('#wg-weather-body').replaceChildren(now, Object.assign(document.createElement('div'), { className: 'wg-days' }));
    $('#wg-weather-body .wg-days').append(...days);
  }
}
