const STORAGE = 'win11web.breakout.';
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


let score = 0, best = read('high', 0), lives = 3, level = 1, lastTime = 0;
let paddle, balls, bricks, drops, shots, effects, keys = {}, transition = 0;
const colors = ['#75c8ed', '#f0b75e', '#ed8e9a', '#83d4aa', '#bea4e8'];
const powerNames = { wide: '패들 확장', multi: '멀티볼', slow: '속도 감소', laser: '레이저' };
function hud() {
  $('#hud').innerHTML = `<div class="card stat"><small>점수</small><strong>${score}</strong></div><div class="card stat"><small>최고 점수</small><strong>${best}</strong></div><div class="card stat"><small>생명</small><strong>${lives}</strong></div><div class="card stat"><small>단계</small><strong>${level}</strong></div>`;
  document.title = `벽돌 깨기 - ${score}점`;
}
function makeLevel() {
  bricks = [];
  for (let row = 0; row < 5; row++) for (let col = 0; col < 9; col++) {
    if (level % 3 === 2 && (row + col) % 4 === 0) continue;
    if (level % 3 === 0 && Math.abs(col - 4) > 4 - Math.floor(row / 2)) continue;
    const hp = (row + col + level) % 5 === 0 ? 2 : 1;
    bricks.push({ x: 25 + col * 61, y: 62 + row * 28, w: 55, h: 21, hp, max: hp, color: colors[row] });
  }
}
function resetBall() { balls = [{ x: paddle.x, y: 520, vx: 135, vy: -235 }]; }
function startGame() {
  score = 0; lives = 3; level = 1; paddle = { x: 300, width: 100 }; drops = []; shots = [];
  effects = { wide: 0, slow: 0, laser: 0, shot: 0 }; transition = 0; particles.length = 0;
  makeLevel(); resetBall(); resume(); hud(); sound();
}
function finish() {
  state = 'over'; best = Math.max(best, score); save('high', best); hud(); shake(); sound(150, .35);
  showOverlay('게임 종료', `${score}점 · 단계 ${level} · 최고 ${best}점`, '다시 시작');
}
function hitBrick(brick) {
  brick.hp--; score += 10; sound(480 + level * 20, .06);
  burst(brick.x + brick.w / 2, brick.y + brick.h / 2, brick.color);
  if (brick.hp <= 0) {
    if (Math.random() < .2) {
      const types = Object.keys(powerNames);
      drops.push({ x: brick.x + brick.w / 2, y: brick.y, type: types[Math.floor(Math.random() * types.length)] });
    }
    bricks.splice(bricks.indexOf(brick), 1);
  }
  hud();
}
function activate(type) {
  sound(800, .18);
  if (type === 'multi') {
    const source = balls[0];
    if (source) for (const factor of [-1, 1]) balls.push({ ...source, vx: source.vx * .65 + factor * 120, vy: -Math.abs(source.vy) });
  } else effects[type] = 10;
}
function update(dt) {
  if (transition > 0) { transition -= dt; return; }
  for (const effect of ['wide', 'slow', 'laser']) effects[effect] = Math.max(0, effects[effect] - dt);
  paddle.width += ((effects.wide ? 160 : 100) - paddle.width) * Math.min(1, dt * 8);
  if (keys.ArrowLeft) paddle.x -= 400 * dt;
  if (keys.ArrowRight) paddle.x += 400 * dt;
  paddle.x = Math.max(paddle.width / 2, Math.min(SIZE - paddle.width / 2, paddle.x));
  if (effects.laser) {
    effects.shot -= dt;
    if (effects.shot <= 0) { shots.push({ x: paddle.x - paddle.width / 3, y: 550 }, { x: paddle.x + paddle.width / 3, y: 550 }); effects.shot = .45; }
  }
  for (const ball of [...balls]) {
    const speed = effects.slow ? .65 : 1;
    ball.x += ball.vx * dt * speed; ball.y += ball.vy * dt * speed;
    if (ball.x < 8 || ball.x > 592) { ball.x = Math.max(8, Math.min(592, ball.x)); ball.vx *= -1; sound(300, .04); }
    if (ball.y < 8) { ball.y = 8; ball.vy = Math.abs(ball.vy); }
    if (ball.vy > 0 && ball.y >= 548 && ball.y <= 565 && Math.abs(ball.x - paddle.x) < paddle.width / 2 + 6) {
      const offset = Math.max(-1, Math.min(1, (ball.x - paddle.x) / (paddle.width / 2)));
      const velocity = Math.min(430, Math.hypot(ball.vx, ball.vy) + 3);
      ball.vx = velocity * Math.sin(offset * 1.1); ball.vy = -velocity * Math.cos(offset * 1.1); ball.y = 548; sound(370, .05);
    }
    for (const brick of bricks) if (ball.x + 7 > brick.x && ball.x - 7 < brick.x + brick.w && ball.y + 7 > brick.y && ball.y - 7 < brick.y + brick.h) {
      ball.vy *= -1; ball.y += Math.sign(ball.vy) * 8; hitBrick(brick); break;
    }
    if (ball.y > 620) balls.splice(balls.indexOf(ball), 1);
  }
  for (const shot of [...shots]) {
    shot.y -= 500 * dt;
    const brick = bricks.find(b => shot.x > b.x && shot.x < b.x + b.w && shot.y > b.y && shot.y < b.y + b.h);
    if (brick) hitBrick(brick);
    if (brick || shot.y < 0) shots.splice(shots.indexOf(shot), 1);
  }
  for (const drop of [...drops]) {
    drop.y += 100 * dt;
    if (drop.y > 540 && drop.y < 575 && Math.abs(drop.x - paddle.x) < paddle.width / 2) { activate(drop.type); drops.splice(drops.indexOf(drop), 1); }
    else if (drop.y > 610) drops.splice(drops.indexOf(drop), 1);
  }
  if (!balls.length) { lives--; shake(); sound(180, .2); hud(); if (!lives) return finish(); resetBall(); transition = 1; }
  if (!bricks.length) { level++; makeLevel(); resetBall(); drops = []; shots = []; transition = 1.5; hud(); sound(750, .2); }
}
function draw(dt) {
  ctx.fillStyle = '#152332'; ctx.fillRect(0, 0, SIZE, SIZE);
  for (const b of bricks) { ctx.fillStyle = b.color; ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 5); ctx.fill(); if (b.hp > 1) { ctx.fillStyle = '#263747'; ctx.fillRect(b.x + 18, b.y + 9, 19, 3); } }
  ctx.fillStyle = '#e5f7ff'; ctx.beginPath(); ctx.roundRect(paddle.x - paddle.width / 2, 555, paddle.width, 12, 6); ctx.fill();
  for (const ball of balls) { ctx.beginPath(); ctx.arc(ball.x, ball.y, 7, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#ffdb75'; for (const shot of shots) ctx.fillRect(shot.x - 2, shot.y, 4, 12);
  for (const drop of drops) { ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.roundRect(drop.x - 25, drop.y - 10, 50, 20, 6); ctx.fill(); ctx.fillStyle = '#172332'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText({wide:'확장',multi:'멀티',slow:'감속',laser:'레이저'}[drop.type], drop.x, drop.y + 4); }
  drawParticles(dt);
  if (transition > 0) { ctx.fillStyle = 'white'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`단계 ${level}`, 300, 320); }
}
function frame(time) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, .025) : 0; lastTime = time;
  if (state === 'playing') { update(dt); draw(dt); }
  requestAnimationFrame(frame);
}
window.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { keys[event.key] = true; event.preventDefault(); } });
window.addEventListener('keyup', event => { keys[event.key] = false; });
window.addEventListener('blur', () => { keys = {}; });
function movePointer(event) { if (state === 'playing') { const rect = canvas.getBoundingClientRect(); paddle.x = (event.clientX - rect.left) / rect.width * SIZE; } }
canvas.addEventListener('pointerdown', event => { canvas.setPointerCapture(event.pointerId); movePointer(event); });
canvas.addEventListener('pointermove', event => { if (event.pointerType === 'mouse' || event.buttons) movePointer(event); });
$('#help').textContent = '방향키, 마우스 또는 터치로 패들 이동 · P / Esc 일시 정지';
showOverlay('벽돌 깨기', '공을 받아 벽돌을 깨고 떨어지는 아이템을 잡으세요.', '게임 시작');
hud(); requestAnimationFrame(frame);
