import { levels } from './levels.js';
import { resolveAxis } from './rules.js';

const $ = id => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
const tile = 40, controls = { left: false, right: false, jump: false };
let state = 'title', levelIndex = 0, player, solids, spikes, shards, enemies, platforms, goal, checkpoint;
let elapsed = 0, collected = 0, lives = 3, camera = 0, shake = 0, particles = [], muted = false, audio;
let width = 0, height = 0, last = 0, accumulator = 0;
const read = () => { try { return JSON.parse(localStorage.getItem('win11web.platformer.progress')) || {}; } catch { return {}; } };
const progress = read();
function save() { try { localStorage.setItem('win11web.platformer.progress', JSON.stringify(progress)); } catch {} }
function sound(frequency) {
  if (muted) return;
  try {
    audio ||= new AudioContext(); audio.resume(); const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = 'triangle'; osc.frequency.value = frequency; gain.gain.setValueAtTime(.12, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .12);
    osc.connect(gain).connect(audio.destination); osc.start(); osc.stop(audio.currentTime + .12);
  } catch {}
}
function options() {
  $('level').replaceChildren();
  levels.forEach((rows, i) => { const p = progress[i]; $('level').add(new Option(`${i + 1}단계 · ${p ? `최고 ${p.time.toFixed(1)}초 · 별 ${p.shards}개` : '기록 없음'}`, i)); });
  $('level').value = levelIndex;
}
function panel(title, message, select, action) { $('heading').textContent = title; $('message').textContent = message; $('selection').hidden = !select; $('start').textContent = action; $('menu').hidden = select; $('overlay').hidden = false; }
function menu() { state = 'title'; options(); panel('별조각 모험', '작은 여행자와 함께 흩어진 별조각을 모아 보세요.', true, '여행 시작'); }
function begin() {
  levelIndex = Number($('level').value); solids = []; spikes = []; shards = []; enemies = []; platforms = []; elapsed = collected = camera = shake = 0; lives = 3; particles = [];
  levels[levelIndex].forEach((row, y) => [...row].forEach((symbol, x) => {
    const box = { x: x * tile, y: y * tile, w: tile, h: tile };
    if (symbol === '#') solids.push(box);
    if (symbol === '^') spikes.push(box);
    if (symbol === '*') shards.push({ ...box, taken: false });
    if (symbol === 'E') enemies.push({ x: box.x + 6, y: box.y + 14, w: 28, h: 26, origin: box.x, dir: 1, alive: true });
    if (symbol === 'M') platforms.push({ x: box.x, y: box.y + 20, w: 70, h: 12, origin: box.x, phase: 0 });
    if (symbol === 'S') checkpoint = { x: box.x + 8, y: box.y + 4 };
    if (symbol === 'G') goal = box;
  }));
  player = { ...checkpoint, w: 24, h: 34, vx: 0, vy: 0, grounded: false, coyote: 0, buffer: 0, wall: 0 };
  state = 'playing'; $('overlay').hidden = true;
}
function pause() { if (state === 'playing') { state = 'paused'; Object.keys(controls).forEach(key => controls[key] = false); panel('일시 정지', '잠시 쉬어 가세요.', false, '계속하기'); } }
function resume() { state = 'playing'; $('overlay').hidden = true; }
function overlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function burst(x, y, color) { for (let i = 0; i < 14; i++) particles.push({ x, y, vx: (Math.random() - .5) * 150, vy: -Math.random() * 150, life: 1, color }); }
function die() {
  shake = 10; sound(120); burst(player.x, player.y, '#ffb6ad'); lives--;
  player.x = checkpoint.x; player.y = checkpoint.y; player.vx = player.vy = 0;
  if (lives <= 0) { state = 'gameover'; panel('여행 종료', `별조각 ${collected}개를 모았어요. 다시 도전해 보세요!`, false, '다시 도전'); }
}
function clear() {
  state = 'clear'; const previous = progress[levelIndex]; progress[levelIndex] = { time: previous ? Math.min(previous.time, elapsed) : elapsed, shards: Math.max(previous?.shards || 0, collected) }; save(); sound(740);
  panel('여정 완료!', `${elapsed.toFixed(1)}초 · 별조각 ${collected} / ${shards.length}개`, false, '다시 도전');
}
function update(dt) {
  particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 250 * dt; p.life -= dt; }); particles = particles.filter(p => p.life > 0); shake *= .88;
  if (state !== 'playing') return;
  elapsed += dt; player.coyote = player.grounded ? .11 : Math.max(0, player.coyote - dt); player.buffer = Math.max(0, player.buffer - dt);
  const direction = Number(controls.right) - Number(controls.left); player.vx += (direction * 190 - player.vx) * Math.min(1, dt * (direction ? 16 : 12));
  if (player.buffer && (player.coyote || player.wall)) { player.vy = -350; if (player.wall && !player.coyote) player.vx = -player.wall * 230; player.buffer = player.coyote = 0; sound(480); }
  if (!controls.jump && player.vy < -120) player.vy += 850 * dt;
  player.vy = Math.min(player.vy + 850 * dt, player.wall && direction === player.wall ? 100 : 550);
  const dx = player.vx * dt, movedX = resolveAxis(player, dx, 'x', solids); player.x += movedX; player.wall = movedX !== dx ? Math.sign(dx) : 0; if (movedX !== dx) player.vx = 0;
  platforms.forEach(p => { p.phase += dt; p.x = p.origin + Math.sin(p.phase * 1.5) * 60; });
  const dy = player.vy * dt, floors = [...solids, ...platforms.filter(p => player.y + player.h <= p.y + 2 && dy >= 0)];
  const movedY = resolveAxis(player, dy, 'y', floors); player.y += movedY; player.grounded = dy > 0 && movedY !== dy; if (movedY !== dy) player.vy = 0;
  if (player.grounded) { const platform = platforms.find(p => Math.abs(player.y + player.h - p.y) < 2 && overlap({ ...player, y: player.y + 2 }, p)); if (platform) player.x += Math.cos(platform.phase * 1.5) * 90 * dt; }
  for (const shard of shards) if (!shard.taken && overlap(player, shard)) { shard.taken = true; collected++; sound(700); burst(shard.x + 20, shard.y + 20, '#ffe684'); }
  for (const enemy of enemies) if (enemy.alive) { enemy.x += enemy.dir * 40 * dt; if (Math.abs(enemy.x - enemy.origin) > 45) enemy.dir *= -1; if (overlap(player, enemy)) { if (dy > 0 && player.y + player.h - movedY <= enemy.y + 8) { enemy.alive = false; player.vy = -260; burst(enemy.x, enemy.y, '#ffa8b9'); sound(360); } else die(); } }
  for (const spike of spikes) if (overlap(player, { ...spike, y: spike.y + 12, h: 28 })) die();
  levels[levelIndex].forEach((row, y) => [...row].forEach((c, x) => { if (c === 'C' && overlap(player, { x: x * tile, y: y * tile, w: tile, h: tile })) checkpoint = { x: x * tile + 8, y: y * tile + 4 }; }));
  if (overlap(player, goal)) clear(); if (player.y > levels[levelIndex].length * tile + 200) die();
  camera += (Math.max(0, player.x - width * .32) - camera) * Math.min(1, dt * 5);
  $('level-label').textContent = `${levelIndex + 1}단계 · 생명 ${lives}`; $('shards').textContent = `✦ ${collected} / ${shards.length}`; $('time').textContent = `${elapsed.toFixed(1)}초`;
}
function resize() { width = canvas.clientWidth; height = canvas.clientHeight; const dpr = devicePixelRatio || 1; canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
function draw() {
  const g = ctx.createLinearGradient(0, 0, 0, height); g.addColorStop(0, '#89bfe4'); g.addColorStop(1, '#f5d5c4'); ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff55'; for (let i = 0; i < 12; i++) { const x = ((i * 180 - camera * .2) % (width + 180) + width + 180) % (width + 180) - 90; ctx.beginPath(); ctx.ellipse(x, height * .25 + (i % 3) * 35, 60, 18, 0, 0, Math.PI * 2); ctx.fill(); }
  if (!player) return;
  ctx.save(); ctx.translate(-camera + (Math.random() - .5) * shake, Math.max(20, height - levels[levelIndex].length * tile - 40));
  solids.forEach(t => { ctx.fillStyle = '#52716d'; ctx.fillRect(t.x, t.y, t.w, t.h); ctx.fillStyle = '#99c9a0'; ctx.fillRect(t.x, t.y, t.w, 7); ctx.fillStyle = '#ffffff20'; ctx.fillRect(t.x + 4, t.y + 13, 7, 4); });
  spikes.forEach(t => { ctx.fillStyle = '#e37984'; ctx.beginPath(); ctx.moveTo(t.x, t.y + tile); ctx.lineTo(t.x + tile / 2, t.y + 8); ctx.lineTo(t.x + tile, t.y + tile); ctx.fill(); });
  levels[levelIndex].forEach((row, y) => [...row].forEach((c, x) => { if (c === 'C') { ctx.fillStyle = '#e5f7ff'; ctx.fillRect(x * tile + 18, y * tile - 12, 3, 52); ctx.fillStyle = '#81d7e5'; ctx.fillRect(x * tile + 21, y * tile - 12, 18, 12); } }));
  platforms.forEach(p => { ctx.fillStyle = '#d5b77c'; ctx.fillRect(p.x, p.y, p.w, p.h); });
  shards.forEach(s => { if (!s.taken) { ctx.fillStyle = '#ffeb86'; ctx.save(); ctx.translate(s.x + 20, s.y + 20); ctx.rotate(Math.PI / 4); ctx.fillRect(-7, -7, 14, 14); ctx.restore(); } });
  enemies.forEach(e => { if (e.alive) { ctx.fillStyle = '#d47e9c'; ctx.fillRect(e.x, e.y, e.w, e.h); ctx.fillStyle = '#332947'; ctx.fillRect(e.x + 6, e.y + 7, 4, 4); ctx.fillRect(e.x + 19, e.y + 7, 4, 4); } });
  ctx.fillStyle = '#fff0a2'; ctx.fillRect(goal.x + 16, goal.y - 20, 4, 60); ctx.fillStyle = '#f78a91'; ctx.fillRect(goal.x + 20, goal.y - 20, 22, 14);
  ctx.fillStyle = '#385c90'; ctx.fillRect(player.x, player.y + 8, player.w, player.h - 8); ctx.fillStyle = '#ffe2c9'; ctx.fillRect(player.x + 3, player.y, 18, 17); ctx.fillStyle = '#27344c'; ctx.fillRect(player.x + 6, player.y + 6, 3, 3); ctx.fillRect(player.x + 15, player.y + 6, 3, 3);
  particles.forEach(p => { ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 5, 5); }); ctx.globalAlpha = 1; ctx.restore();
}
function frame(now) { if (!last) last = now; accumulator += Math.min((now - last) / 1000, .1); last = now; while (accumulator >= 1 / 60) { update(1 / 60); accumulator -= 1 / 60; } draw(); requestAnimationFrame(frame); }
function setKey(key, down) { if (key === 'jump' && down && !controls.jump && player) player.buffer = .12; controls[key] = down; }
$('start').onclick = () => state === 'paused' ? resume() : begin(); $('menu').onclick = menu; $('restart').onclick = begin; $('pause').onclick = () => state === 'paused' ? resume() : pause(); $('sound').onclick = () => { muted = !muted; $('sound').textContent = muted ? '소리 꺼짐' : '소리 켜짐'; };
const keyMap = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'jump', w: 'jump', ' ': 'jump' };
document.addEventListener('keydown', e => { const key = e.key.toLowerCase(); if (keyMap[key]) { e.preventDefault(); setKey(keyMap[key], true); } else if (!e.repeat && (key === 'p' || key === 'escape')) { e.preventDefault(); state === 'paused' ? resume() : pause(); } });
document.addEventListener('keyup', e => { const key = keyMap[e.key.toLowerCase()]; if (key) setKey(key, false); });
document.querySelectorAll('[data-key]').forEach(button => { button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); setKey(button.dataset.key, true); }); ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(event => button.addEventListener(event, () => setKey(button.dataset.key, false))); });
window.addEventListener('blur', pause); document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); }); window.addEventListener('resize', resize); options(); resize(); requestAnimationFrame(frame);
