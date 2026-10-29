
const STORAGE = 'win11web.snake.';

const $ = selector => document.querySelector(selector);
const overlay = $('#overlay');
const title = $('#overlay-title');
const message = $('#message');
const options = $('#options');
const startButton = $('#start');
const stage = $('#stage');
let state = 'start';
let muted = false;
let audio;

function read(key, fallback = 0) {
  try { return JSON.parse(localStorage.getItem(STORAGE + key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORAGE + key, JSON.stringify(value)); } catch { /* Storage is optional. */ }
}
function sound(frequency = 440, duration = .1) {
  if (muted) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.08, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + duration);
  } catch { /* Audio is optional. */ }
}
function shake() {
  stage.classList.remove('shake');
  void stage.offsetWidth;
  stage.classList.add('shake');
}
function showOverlay(heading, detail, button, showOptions = false) {
  title.textContent = heading;
  message.textContent = detail;
  startButton.textContent = button;
  options.hidden = !showOptions;
  overlay.hidden = false;
}
function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  showOverlay('일시 정지', '게임이 일시 정지되었습니다.', '계속하기');
}
function resume() {
  state = 'playing';
  overlay.hidden = true;
  lastTime = 0;
}
$('#pause').onclick = () => state === 'playing' ? pause() : state === 'paused' ? resume() : null;
$('#restart').onclick = () => startGame();
$('#mute').onclick = () => {
  muted = !muted;
  $('#mute span').textContent = muted ? '소리 켜기' : '소리 끄기';
  $('#mute').setAttribute('aria-pressed', String(muted));
  if (!muted) sound();
};
startButton.onclick = () => state === 'paused' ? resume() : startGame();
window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('keydown', event => {
  if (event.key.toLowerCase() === 'p' || event.key === 'Escape') {
    event.preventDefault();
    if (state === 'playing') pause(); else if (state === 'paused') resume();
  }
});

const canvas = $('#game');
const ctx = canvas.getContext('2d');
const SIZE = 600;
function resize() {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(width * ratio);
  ctx.setTransform(canvas.width / SIZE, 0, 0, canvas.height / SIZE, 0, 0);
}
window.addEventListener('resize', resize);
resize();
const particles = [];
function burst(x, y, color) {
  for (let i = 0; i < 12; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 30 + Math.random() * 110;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: .6, color });
  }
}
function drawParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    ctx.globalAlpha = Math.max(0, p.life / .6);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 5, 5);
    if (p.life <= 0) particles.splice(i, 1);
  }
  ctx.globalAlpha = 1;
}

const GRID = 20;
const CELL = SIZE / GRID;
let snake, previous, direction, queued, food, bonus, bonusTime, score, accumulator, lastTime = 0;
let best = read('high', 0);
const vectors = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
function randomCell() {
  const empty = [];
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    if (!snake.some(part => part.x === x && part.y === y) && (!food || food.x !== x || food.y !== y) && (!bonus || bonus.x !== x || bonus.y !== y)) empty.push({ x, y });
  }
  return empty.length ? empty[Math.floor(Math.random() * empty.length)] : null;
}
function hud() {
  $('#hud').innerHTML = `<div class="card stat"><small>점수</small><strong>${score || 0}</strong></div><div class="card stat"><small>최고 점수</small><strong>${best}</strong></div><div class="card stat"><small>보너스</small><strong>${bonus ? Math.ceil(bonusTime) + '초' : '없음'}</strong></div>`;
  document.title = `뱀 게임 - ${score || 0}점`;
}
function startGame() {
  snake = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }];
  previous = snake.map(p => ({ ...p })); direction = [1, 0]; queued = direction;
  food = null; bonus = null; food = randomCell(); bonusTime = 0; score = 0; accumulator = 0;
  particles.length = 0; resume(); hud(); sound(440);
}
function turn(name) {
  const next = vectors[name];
  if (state === 'playing' && next && (next[0] !== -direction[0] || next[1] !== -direction[1])) queued = next;
}
function gameOver(won = false) {
  state = 'over'; best = Math.max(best, score); save('high', best); hud(); shake(); sound(160, .3);
  showOverlay(won ? '게임을 완료했습니다!' : '게임 종료', `${score}점 · 최고 ${best}점`, '다시 시작', true);
}
function step() {
  previous = snake.map(p => ({ ...p })); direction = queued;
  let x = snake[0].x + direction[0], y = snake[0].y + direction[1];
  if ($('#wrap').checked) { x = (x + GRID) % GRID; y = (y + GRID) % GRID; }
  const eating = food && x === food.x && y === food.y;
  const eatingBonus = bonus && x === bonus.x && y === bonus.y;
  if (x < 0 || y < 0 || x >= GRID || y >= GRID || snake.slice(0, eating || eatingBonus ? undefined : -1).some(p => p.x === x && p.y === y)) return gameOver();
  snake.unshift({ x, y });
  if (eating || eatingBonus) {
    score += eatingBonus ? 5 : 1; burst((x + .5) * CELL, (y + .5) * CELL, eatingBonus ? '#ffd166' : '#ff7f8c'); sound(eatingBonus ? 850 : 600);
    if (eatingBonus) bonus = null; else { food = null; food = randomCell(); }
    if (!food) return gameOver(true);
    if (!bonus && Math.random() < .18) { bonus = randomCell(); bonusTime = 8; }
    hud();
  } else snake.pop();
}
function frame(time) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, .05) : 0; lastTime = time;
  if (state === 'playing') {
    if (bonus) { bonusTime -= dt; if (bonusTime <= 0) { bonus = null; hud(); } else hud(); }
    accumulator += dt;
    const base = { easy: .22, normal: .16, hard: .11 }[$('#difficulty').value];
    const interval = Math.max(.065, base - score * .002);
    while (accumulator >= interval && state === 'playing') { accumulator -= interval; step(); }
    ctx.fillStyle = '#152332'; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = 'rgba(255,255,255,.035)';
    for (let i = 0; i <= GRID; i++) { ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, SIZE); ctx.moveTo(0, i * CELL); ctx.lineTo(SIZE, i * CELL); ctx.stroke(); }
    for (const [item, color] of [[food, '#ff7f8c'], [bonus, '#ffd166']]) if (item) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc((item.x + .5) * CELL, (item.y + .5) * CELL, CELL * .32, 0, Math.PI * 2); ctx.fill(); }
    const t = Math.min(1, accumulator / interval);
    snake.forEach((part, i) => {
      const old = previous[i] || part;
      const x = Math.abs(old.x - part.x) > 1 ? part.x : old.x + (part.x - old.x) * t;
      const y = Math.abs(old.y - part.y) > 1 ? part.y : old.y + (part.y - old.y) * t;
      ctx.fillStyle = i ? '#56c99b' : '#a3f0c9'; ctx.beginPath(); ctx.roundRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4, 7); ctx.fill();
    });
    drawParticles(dt);
  }
  requestAnimationFrame(frame);
}
window.addEventListener('keydown', event => {
  const name = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[event.key];
  if (name && state === 'playing') { event.preventDefault(); turn(name); }
});
document.querySelectorAll('[data-dir]').forEach(button => button.onclick = () => turn(button.dataset.dir));
let touchStart;
canvas.addEventListener('pointerdown', event => { touchStart = [event.clientX, event.clientY]; });
canvas.addEventListener('pointerup', event => {
  if (!touchStart) return;
  const dx = event.clientX - touchStart[0], dy = event.clientY - touchStart[1]; touchStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) > 20) turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
});
$('#help').textContent = '방향키 또는 스와이프로 이동 · P / Esc 일시 정지';
showOverlay('뱀 게임', '먹이를 먹고 자라세요. 보너스 먹이는 5점!', '게임 시작', true);
hud(); requestAnimationFrame(frame);
