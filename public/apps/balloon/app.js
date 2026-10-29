import { W, H, WALL, BOX, LAYOUTS, SPIRAL, SUDDEN, createGame, step } from './rules.js';
import { createBrain, botInput } from './ai.js';
import { Online } from './online.js';

const TILE = 16;
const STEP = 1 / 60;
const STORE = 'win11web.balloon.';
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const stage = $('stage');
// The arena is drawn at its native 16px-per-tile size, then scaled up without smoothing.
const pixels = document.createElement('canvas');
pixels.width = W * TILE;
pixels.height = H * TILE;
const px = pixels.getContext('2d');
const touchCapable = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const panels = ['title-panel', 'lobby-panel', 'pause-panel', 'result-panel'];

let mode = 'solo';          // 'solo' | 'online'
let state = 'title';        // 'title' | 'ready' | 'playing' | 'paused' | 'over'
let game = null;
let brains = [];
let ready = 0;
let accumulator = 0;
let lastFrame = 0;
let clock = 0;
let resultTimer = 0;
let shownSudden = false;
let me = 0;
let display = [];
let placeLatch = false;
let held = [];
let touchDir = null;
let muted = false;
let audio = null;
let hudKey = '';

function read(key, fallback) {
  try { const v = localStorage.getItem(STORE + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* storage is optional */ }
}

// ---------- sound ----------
function tone(freq, duration, { type = 'square', to = freq, volume = 0.05, delay = 0 } = {}) {
  if (muted) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + duration);
  } catch { /* audio is optional */ }
}
function splash() {
  if (muted) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const length = Math.floor(audio.sampleRate * 0.25);
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
    const source = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    gain.gain.value = 0.18;
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(audio.destination);
    source.start();
  } catch { /* audio is optional */ }
}
const SOUNDS = {
  place: () => tone(180, 0.08, { to: 120, volume: 0.06 }),
  pop: splash,
  trap: () => tone(300, 0.35, { type: 'triangle', to: 900, volume: 0.06 }),
  item: () => { tone(660, 0.07); tone(990, 0.09, { delay: 0.07 }); },
  out: () => tone(520, 0.4, { type: 'sawtooth', to: 90, volume: 0.04 }),
  wall: () => tone(90, 0.06, { volume: 0.04 }),
};
function playEvents(events) {
  const seen = new Set();
  for (const e of events) {
    if (seen.has(e.type)) continue;
    seen.add(e.type);
    SOUNDS[e.type]?.();
  }
}
function fanfare(win) {
  const notes = win ? [523, 659, 784, 1046] : [392, 330, 262];
  notes.forEach((n, i) => tone(n, 0.16, { delay: i * 0.13, volume: 0.05 }));
}

// ---------- drawing ----------
const hash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;
function rect(x, y, w, h, color) { px.fillStyle = color; px.fillRect(x, y, w, h); }

function drawFloor(x, y, layout) {
  const ox = x * TILE;
  const oy = y * TILE;
  const garden = layout === 'garden';
  const even = (x + y) % 2 === 0;
  rect(ox, oy, TILE, TILE, garden ? (even ? '#e4cf9b' : '#dcc58e') : (even ? '#67b65f' : '#5eac57'));
  const h = hash(x, y);
  const speck = garden ? '#cdb37a' : '#4f9a4a';
  rect(ox + (h % 13) + 1, oy + ((h >> 4) % 13) + 1, 1, 2, speck);
  rect(ox + ((h >> 8) % 12) + 2, oy + ((h >> 12) % 12) + 2, 2, 1, speck);
  if (garden && h % 7 === 0) { rect(ox + 6, oy + 7, 2, 2, '#f08bb0'); rect(ox + 7, oy + 6, 1, 1, '#fff'); }
}

function drawWall(x, y, layout, closing) {
  const ox = x * TILE;
  const oy = y * TILE;
  const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
  if (layout === 'garden' && !edge && !closing) {
    rect(ox + 1, oy + 7, 14, 9, '#b0623b');
    rect(ox + 1, oy + 7, 14, 2, '#cf7d50');
    rect(ox + 2, oy + 1, 12, 7, '#3f9a4b');
    rect(ox + 4, oy, 8, 3, '#55b55e');
    rect(ox + 5, oy + 2, 2, 2, '#ffd166');
    rect(ox + 10, oy + 3, 2, 2, '#ff8fab');
    return;
  }
  const base = closing ? '#8c5a66' : edge ? '#4d5872' : '#8a95ab';
  const light = closing ? '#b07884' : edge ? '#66718d' : '#b4bfd2';
  const dark = closing ? '#5e3a44' : edge ? '#353d52' : '#5c6680';
  rect(ox, oy, TILE, TILE, base);
  rect(ox, oy, TILE, 2, light);
  rect(ox, oy + 14, TILE, 2, dark);
  rect(ox, oy + 7, TILE, 1, dark);
  rect(ox + ((y % 2) ? 4 : 10), oy + 2, 1, 5, dark);
  rect(ox + ((y % 2) ? 11 : 5), oy + 8, 1, 6, dark);
}

function drawBox(x, y) {
  const ox = x * TILE;
  const oy = y * TILE;
  rect(ox + 1, oy + 1, 14, 14, '#c98a4b');
  rect(ox + 1, oy + 1, 14, 2, '#e3a865');
  rect(ox + 1, oy + 13, 14, 2, '#8a5528');
  rect(ox + 1, oy + 7, 14, 1, '#8a5528');
  rect(ox + 3, oy + 3, 1, 10, '#a86d36');
  rect(ox + 12, oy + 3, 1, 10, '#a86d36');
}

function drawItem(x, y, item, t) {
  const ox = x * TILE;
  const oy = y * TILE + Math.round(Math.sin(t * 5 + x) * 1);
  rect(ox + 2, oy + 2, 12, 12, '#1b2433');
  rect(ox + 3, oy + 3, 10, 10, item === 'count' ? '#2c6db8' : item === 'range' ? '#2a8f9e' : '#b8892c');
  if (item === 'count') {
    rect(ox + 6, oy + 4, 4, 1, '#9be0ff'); rect(ox + 5, oy + 5, 6, 4, '#9be0ff'); rect(ox + 6, oy + 9, 4, 1, '#9be0ff');
    rect(ox + 7, oy + 10, 2, 2, '#fff'); rect(ox + 6, oy + 5, 1, 1, '#fff');
  } else if (item === 'range') {
    rect(ox + 7, oy + 4, 2, 2, '#c9f3ff'); rect(ox + 6, oy + 6, 4, 2, '#c9f3ff'); rect(ox + 5, oy + 8, 6, 3, '#c9f3ff'); rect(ox + 6, oy + 11, 4, 1, '#c9f3ff');
  } else {
    rect(ox + 5, oy + 5, 3, 5, '#ffe9a8'); rect(ox + 5, oy + 10, 7, 2, '#ffe9a8'); rect(ox + 9, oy + 4, 3, 1, '#fff'); rect(ox + 10, oy + 6, 3, 1, '#fff');
  }
}

function drawBurst(game, s) {
  const ox = s.x * TILE;
  const oy = s.y * TILE;
  const wet = (dx, dy) => game.bursts.some((o) => o.x === s.x + dx && o.y === s.y + dy);
  const fade = Math.min(1, s.t / 0.15);
  px.globalAlpha = 0.55 + 0.45 * fade;
  rect(ox + 2, oy + 2, 12, 12, '#58c7ff');
  if (wet(-1, 0) || wet(1, 0)) rect(ox + (wet(-1, 0) ? 0 : 2), oy + 3, (wet(-1, 0) ? 2 : 0) + 12 + (wet(1, 0) ? 2 : 0), 10, '#58c7ff');
  if (wet(0, -1) || wet(0, 1)) rect(ox + 3, oy + (wet(0, -1) ? 0 : 2), 10, (wet(0, -1) ? 2 : 0) + 12 + (wet(0, 1) ? 2 : 0), '#58c7ff');
  rect(ox + 5, oy + 5, 6, 6, '#d8f6ff');
  if (wet(-1, 0) || wet(1, 0)) rect(ox + (wet(-1, 0) ? 0 : 5), oy + 6, (wet(-1, 0) ? 5 : 0) + 6 + (wet(1, 0) ? 5 : 0), 4, '#d8f6ff');
  if (wet(0, -1) || wet(0, 1)) rect(ox + 6, oy + (wet(0, -1) ? 0 : 5), 4, (wet(0, -1) ? 5 : 0) + 6 + (wet(0, 1) ? 5 : 0), '#d8f6ff');
  px.globalAlpha = 1;
}

function drawBalloon(b, color, t) {
  const pulse = b.timer < 0.8 ? Math.round(Math.sin(t * 40)) : Math.round(Math.sin(t * 8) * 0.6);
  const ox = b.x * TILE + 2 - (pulse > 0 ? 1 : 0);
  const oy = b.y * TILE + 3 - (pulse > 0 ? 1 : 0);
  const s = 12 + (pulse > 0 ? 2 : 0);
  rect(ox + 2, oy + s - 1, s - 4, 2, '#0003');
  rect(ox + 3, oy, s - 6, s - 1, color);
  rect(ox + 1, oy + 2, s - 2, s - 5, color);
  rect(ox, oy + 4, s, s - 9, color);
  rect(ox + 3, oy + 2, 2, 2, '#ffffffd0');
  rect(ox + s / 2 - 1, oy - 2, 2, 2, color);
}

function drawPlayer(p, pos, t, isMe) {
  const bob = p.moving && !p.trapped ? Math.round(Math.abs(Math.sin(t * 14))) : 0;
  const ox = Math.round(pos.x * TILE) + 2;
  const oy = Math.round(pos.y * TILE) - 2 - bob;
  const face = { down: [4, 6], up: null, left: [2, 4], right: [6, 8] }[p.dir];
  rect(ox + 1, oy + 15 + bob, 10, 2, '#0004');
  rect(ox + 2, oy + 13, 3, 3, '#2a2f3a');
  rect(ox + 7, oy + 13, 3, 3, '#2a2f3a');
  rect(ox + 1, oy + 8, 10, 6, p.color);
  rect(ox + 1, oy + 8, 10, 1, '#ffffff55');
  rect(ox + 2, oy + 2, 8, 7, '#ffd9b0');
  rect(ox + 1, oy, 10, 3, p.color);
  rect(ox + 3, oy - 1, 6, 1, p.color);
  if (face) { rect(ox + face[0], oy + 4, 1, 2, '#1b1b1b'); rect(ox + face[1], oy + 4, 1, 2, '#1b1b1b'); }
  if (isMe) {
    rect(ox + 4, oy - 6, 4, 1, '#fff'); rect(ox + 5, oy - 5, 2, 1, '#fff');
  }
  if (p.trapped) {
    const r = 10 + Math.round(Math.sin(t * 6));
    px.globalAlpha = 0.45;
    px.fillStyle = '#9fe6ff';
    px.beginPath();
    px.arc(ox + 6, oy + 8, r, 0, Math.PI * 2);
    px.fill();
    px.globalAlpha = 1;
    rect(ox, oy + 1, 3, 2, '#fff');
    rect(ox - 1, oy + 3, 1, 3, '#fff');
  }
}

function render(t) {
  const g = game;
  rect(0, 0, pixels.width, pixels.height, '#0f1620');
  if (g) {
    const layout = g.layout || roomLayout();
    const closing = new Set(SPIRAL.slice(0, g.closed || 0).map(([x, y]) => y * W + x));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = y * W + x;
        const tile = g.tiles[k];
        if (tile === WALL) drawWall(x, y, layout, closing.has(k));
        else {
          drawFloor(x, y, layout);
          if (tile === BOX) drawBox(x, y);
          else if (g.items[k]) drawItem(x, y, g.items[k], t);
        }
      }
    }
    for (const s of g.bursts) drawBurst(g, s);
    for (const b of g.balloons) drawBalloon(b, g.players[b.owner]?.color || '#4fc3f7', t);
    const order = g.players.map((p, i) => i).filter((i) => g.players[i].alive).sort((a, b) => display[a].y - display[b].y);
    for (const i of order) drawPlayer(g.players[i], display[i], t, i === me && (mode === 'solo' || online.isPlayer));
  }
  const cw = canvas.width;
  const ch = canvas.height;
  // Whole-number scales keep pixels even; past 3x the leftover space matters more.
  const fit = Math.min(cw / pixels.width, ch / pixels.height);
  const scale = fit >= 1 && fit < 3 && fit % 1 < 0.15 ? Math.floor(fit) : fit;
  const w = pixels.width * scale;
  const h = pixels.height * scale;
  // With the touch pad showing, keep the arena at the top so the thumbs do not cover it.
  const top = $('touch').hidden ? Math.round((ch - h) / 2) : Math.min(Math.round((ch - h) / 2), Math.round(8 * (window.devicePixelRatio || 1)));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0f1620';
  ctx.fillRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(pixels, Math.round((cw - w) / 2), top, w, h);
}

function resize() {
  const r = stage.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.max(1, Math.round(r.width * ratio));
  canvas.height = Math.max(1, Math.round(r.height * ratio));
}

// ---------- HUD ----------
function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function updateHud() {
  if (!game) return;
  const left = game.limit - game.time;
  const key = formatClock(left) + game.players.map((p) => [p.alive, !!p.trapped, p.count, p.range, p.speed, p.name].join()).join('|');
  if (key === hudKey) return;
  hudKey = key;
  $('clock').textContent = formatClock(left);
  $('clock').classList.toggle('sudden', left <= SUDDEN);
  $('roster').replaceChildren(...game.players.map((p, i) => {
    const li = document.createElement('li');
    li.className = (p.alive ? '' : 'out') + (i === me && (mode === 'solo' || online.isPlayer) ? ' me' : '');
    const dot = document.createElement('i');
    dot.style.background = p.color;
    const name = document.createElement('b');
    name.textContent = p.name + (p.trapped ? ' 💧' : '');
    const stats = document.createElement('small');
    stats.textContent = p.alive ? `풍선 ${p.count} · 물줄기 ${p.range} · 속도 ${Math.round((p.speed - 3.2) / 0.45) + 1}` : '탈락';
    li.append(dot, name, stats);
    return li;
  }));
}

function banner(text, seconds = 1.2) {
  const el = $('banner');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(banner.timer);
  banner.timer = setTimeout(() => { el.hidden = true; }, seconds * 1000);
}

// ---------- panels ----------
function showPanel(name) {
  $('overlay').hidden = !name;
  for (const id of panels) $(id).hidden = id !== name;
  if (name) $(name).querySelector('button:not([hidden]), input')?.focus({ preventScroll: true });
}

function setTab(online) {
  $('tab-solo').setAttribute('aria-selected', String(!online));
  $('tab-online').setAttribute('aria-selected', String(online));
  $('solo').hidden = online;
  $('online').hidden = !online;
}

function playerName() {
  const name = $('name').value.trim().slice(0, 12) || '플레이어';
  save('name', name);
  return name;
}

function showRecord() {
  const r = read('record', { wins: 0, rounds: 0 });
  $('record').textContent = r.rounds ? `지금까지 ${r.rounds}판 중 ${r.wins}번 이겼습니다.` : '';
}

function toTitle() {
  if (mode === 'online') online.leave();
  mode = 'solo';
  state = 'title';
  game = null;
  $('hud').hidden = true;
  $('touch').hidden = true;
  $('mode-label').textContent = '레트로 아레나';
  $('pause').hidden = false;
  $('restart').hidden = false;
  showRecord();
  showPanel('title-panel');
}

function resetView() {
  display = game.players.map((p) => ({ x: p.x, y: p.y }));
  hudKey = '';
  shownSudden = false;
  held = [];
  touchDir = null;
  placeLatch = false;
  $('hud').hidden = false;
  $('touch').hidden = !touchCapable;
  updateHud();
}

// ---------- solo ----------
function startSolo() {
  mode = 'solo';
  const bots = Number($('bots').value);
  const level = $('level').value;
  const layout = $('layout').value;
  save('bots', bots); save('level', level); save('layout', layout);
  // Bot names follow their colors (red, yellow, purple).
  const names = [playerName(), '토마토', '귤귤이', '포도알'];
  game = createGame({ players: bots + 1, names, bots: [false, true, true, true], layout, seed: Math.floor(Math.random() * 2 ** 31) });
  brains = game.players.map(() => createBrain(level));
  me = 0;
  ready = 1.6;
  state = 'ready';
  accumulator = 0;
  resetView();
  $('mode-label').textContent = `${LAYOUTS[layout]} · 혼자 하기`;
  showPanel(null);
  banner('READY', 1);
  tone(440, 0.12, { delay: 0 }); tone(440, 0.12, { delay: 0.5 }); tone(880, 0.25, { delay: 1.0 });
}

function soloInputs() {
  const inputs = game.players.map((p, i) => (i === 0 ? { dir: heldDir(), place: placeLatch } : botInput(game, i, brains[i], STEP)));
  placeLatch = false;
  return inputs;
}

function pause() {
  if (mode !== 'solo' || (state !== 'playing' && state !== 'ready')) return;
  state = 'paused';
  held = [];
  showPanel('pause-panel');
}

function resume() {
  if (state !== 'paused') return;
  state = ready > 0 ? 'ready' : 'playing';
  lastFrame = 0;
  showPanel(null);
}

// ---------- online ----------
const online = new Online({
  onRoom(room) {
    renderLobby(room);
    if (room.phase === 'playing' && state !== 'playing') {
      mode = 'online';
      state = 'playing';
      showPanel(null);
      $('mode-label').textContent = `${LAYOUTS[room.layout]} · 온라인 ${room.code}`;
      banner('GO!', 0.9);
      tone(880, 0.25);
    } else if (room.phase !== 'playing' && state === 'title' && mode === 'online') {
      showPanel('lobby-panel');
    }
  },
  onFrame(next) {
    const fresh = !game || game.players.length !== next.players.length || next.time < (game.time || 0);
    game = next;
    me = online.seat;
    if (fresh) resetView();
    playEvents(next.events);
    if (next.phase === 'over' && state === 'playing') finish();
  },
  onError(message) { $('lobby-error').textContent = message; $('title-error').textContent = message; },
});

function roomLayout() { return online.room?.layout || 'pillars'; }

function renderLobby(room) {
  $('room-code').textContent = room.code;
  const items = room.seats.map((s, i) => {
    const li = document.createElement('li');
    const dot = document.createElement('i');
    dot.style.background = s.color;
    const label = document.createElement('span');
    label.textContent = `${s.name}${s.host ? ' 👑' : ''}${i === online.seat ? ' (나)' : ''}${s.gone ? ' · 나감' : s.connected ? '' : ' · 연결 끊김'}`;
    const wins = document.createElement('small');
    wins.textContent = `${s.wins}승`;
    li.append(dot, label, wins);
    return li;
  });
  for (let i = room.seats.length; i < room.seats.length + room.bots; i++) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = `🤖 컴퓨터 ${i - room.seats.length + 1}`;
    items.push(li);
  }
  for (let i = items.length; i < 4; i++) items.push(Object.assign(document.createElement('li'), { className: 'empty', textContent: '빈자리' }));
  $('seats').replaceChildren(...items);
  const host = online.isHost;
  $('room-layout').value = room.layout;
  $('room-layout').disabled = !host;
  const free = 4 - room.seats.length;
  $('room-bots').replaceChildren(...Array.from({ length: free + 1 }, (_, n) => new Option(`${n}명`, String(n))));
  $('room-bots').value = String(room.bots);
  $('room-bots').disabled = !host;
  $('room-start').hidden = !host;
  const total = room.seats.length + room.bots;
  $('lobby-note').textContent = !online.isPlayer ? '자리가 없어 관전합니다.'
    : host ? (total < 2 ? '친구를 기다리거나 컴퓨터를 넣으면 시작할 수 있습니다.' : `${total}명으로 시작할 수 있습니다.`)
    : '방장이 시작하길 기다리는 중…';
  $('again').hidden = mode === 'online' && !host;
  if (mode === 'online') $('result-note').textContent = host ? '' : '방장이 다음 판을 시작하면 바로 이어집니다.';
}

async function runOnline(action, errorId = 'title-error') {
  $(errorId).textContent = '';
  try { await action(); } catch (err) { $(errorId).textContent = err.message; }
}

function enterOnline() {
  mode = 'online';
  state = 'title';
  game = null;
  $('pause').hidden = true;
  $('restart').hidden = true;
  showPanel('lobby-panel');
}

// ---------- round end ----------
function finish() {
  state = 'over';
  held = [];
  const g = game;
  const won = g.winner === me && (mode === 'solo' || online.isPlayer);
  if (mode === 'solo') {
    const r = read('record', { wins: 0, rounds: 0 });
    save('record', { wins: r.wins + (won ? 1 : 0), rounds: r.rounds + 1 });
  }
  banner(g.winner === null ? 'DRAW' : won ? 'YOU WIN!' : 'GAME SET', 1.4);
  fanfare(won);
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => {
    if (state !== 'over') return;
    $('result-heading').textContent = g.winner === null ? '무승부' : won ? '승리!' : `${g.players[g.winner].name} 승리`;
    const order = g.players.map((p, i) => i).sort((a, b) => (b === g.winner) - (a === g.winner) || g.players[b].pops - g.players[a].pops);
    $('results').replaceChildren(...order.map((i) => {
      const p = g.players[i];
      const li = document.createElement('li');
      const dot = document.createElement('i');
      dot.style.background = p.color;
      const name = document.createElement('span');
      name.textContent = `${p.name}${i === g.winner ? ' 🏆' : ''}`;
      const info = document.createElement('small');
      info.textContent = `터뜨림 ${p.pops} · 풍선 ${p.count} · 물줄기 ${p.range}`;
      li.append(dot, name, info);
      return li;
    }));
    if (online.room) renderLobby(online.room);
    else { $('again').hidden = false; $('result-note').textContent = ''; }
    $('result-title').textContent = mode === 'online' ? '대기실로' : '처음으로';
    showPanel('result-panel');
  }, 1500);
}

// ---------- input ----------
const KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
const heldDir = () => touchDir || held.at(-1) || null;
const playing = () => state === 'playing' && (mode === 'solo' || online.isPlayer);

function sendInput(place = false) {
  if (mode === 'online') online.input(heldDir(), place);
  else if (place) placeLatch = true;
}

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea')) return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (state === 'paused') resume(); else pause();
    e.preventDefault();
    return;
  }
  if (!playing() && state !== 'ready') return;
  const dir = KEYS[e.code];
  if (dir) {
    e.preventDefault();
    if (!held.includes(dir)) { held.push(dir); sendInput(); }
  } else if ((e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyJ') && !e.repeat) {
    e.preventDefault();
    if (state === 'playing') sendInput(true);
  }
});
window.addEventListener('keyup', (e) => {
  const dir = KEYS[e.code];
  if (dir && held.includes(dir)) { held = held.filter((d) => d !== dir); sendInput(); }
});

for (const button of document.querySelectorAll('.pad button')) {
  const release = () => { button.classList.remove('on'); if (touchDir === button.dataset.dir) { touchDir = null; sendInput(); } };
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    button.classList.add('on');
    touchDir = button.dataset.dir;
    sendInput();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
}
$('touch-drop').addEventListener('pointerdown', (e) => { e.preventDefault(); if (state === 'playing') sendInput(true); });

// ---------- controls ----------
$('tab-solo').onclick = () => setTab(false);
$('tab-online').onclick = () => setTab(true);
$('start').onclick = startSolo;
$('again').onclick = () => (mode === 'online' ? runOnline(() => online.start(), 'lobby-error').then(() => { if ($('lobby-error').textContent) showPanel('lobby-panel'); }) : startSolo());
$('result-title').onclick = () => (mode === 'online' ? showPanel('lobby-panel') : toTitle());
$('resume').onclick = resume;
$('pause-restart').onclick = startSolo;
$('pause-title').onclick = toTitle;
$('pause').onclick = () => (state === 'paused' ? resume() : pause());
$('restart').onclick = () => { if (mode === 'solo' && state !== 'title') startSolo(); };
$('sound').onclick = () => {
  muted = !muted;
  save('muted', muted);
  $('sound').setAttribute('aria-pressed', String(muted));
  $('sound').title = muted ? '소리 켜기' : '소리 끄기';
};
$('create-room').onclick = () => runOnline(async () => { await online.create(playerName()); enterOnline(); });
$('join-form').onsubmit = (e) => {
  e.preventDefault();
  runOnline(async () => { await online.join($('join-code').value, playerName()); enterOnline(); });
};
$('room-start').onclick = () => runOnline(() => online.start({ layout: $('room-layout').value, bots: Number($('room-bots').value) }), 'lobby-error');
$('room-layout').onchange = () => runOnline(() => online.configure({ layout: $('room-layout').value }), 'lobby-error');
$('room-bots').onchange = () => runOnline(() => online.configure({ bots: Number($('room-bots').value) }), 'lobby-error');
$('leave-room').onclick = toTitle;
$('copy-link').onclick = async () => {
  try {
    await navigator.clipboard.writeText(online.link());
    $('copy-link').textContent = '복사됨';
    setTimeout(() => { $('copy-link').textContent = '초대 링크 복사'; }, 1500);
  } catch { $('lobby-error').textContent = online.link(); }
};

window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(stage);

// ---------- loop ----------
function frame(now) {
  const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  clock += dt;
  if (mode === 'solo' && game) {
    if (state === 'ready') {
      ready -= dt;
      if (ready <= 0) { state = 'playing'; banner('GO!', 0.7); }
    }
    if (state === 'playing') {
      accumulator += dt;
      while (accumulator >= STEP && game.phase === 'playing') {
        accumulator -= STEP;
        game.events = [];
        step(game, STEP, soloInputs());
        playEvents(game.events);
      }
      if (game.phase === 'over') finish();
    }
    game.players.forEach((p, i) => { display[i] = { x: p.x, y: p.y }; });
  } else if (game) {
    // Online frames arrive 20 times a second; glide between them.
    const k = 1 - Math.exp(-dt * 18);
    game.players.forEach((p, i) => {
      const d = display[i] || (display[i] = { x: p.x, y: p.y });
      if (Math.abs(d.x - p.x) + Math.abs(d.y - p.y) > 1.5) { d.x = p.x; d.y = p.y; }
      d.x += (p.x - d.x) * k;
      d.y += (p.y - d.y) * k;
    });
  }
  if (game && game.phase === 'playing' && !shownSudden && game.limit - game.time <= SUDDEN) {
    shownSudden = true;
    banner('SUDDEN DEATH', 1.6);
  }
  updateHud();
  render(clock);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
for (const [id, label] of Object.entries(LAYOUTS)) {
  $('layout').append(new Option(label, id));
  $('room-layout').append(new Option(label, id));
}
$('name').value = read('name', '');
$('layout').value = read('layout', 'pillars');
$('bots').value = String(read('bots', 3));
$('level').value = read('level', 'normal');
muted = read('muted', false);
$('sound').setAttribute('aria-pressed', String(muted));
showRecord();
resize();
showPanel('title-panel');
const invited = new URLSearchParams(location.search).get('room');
if (invited) {
  setTab(true);
  $('join-code').value = invited;
  runOnline(async () => { await online.join(invited, playerName()); enterOnline(); });
}
requestAnimationFrame(frame);
