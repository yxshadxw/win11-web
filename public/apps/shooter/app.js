const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);
const keys = new Set();
let width = 0, height = 0, state = 'title', last = 0, audio, muted = false;
let player, enemies, shots, bullets, particles, drops, stars = [], wave, score, lives, bombs, streak, spawnTimer, waveTimer, fireTimer, shake, boss;
let best = readBest();

function readBest() {
  try { return Number(localStorage.getItem('win11web.shooter.highscore')) || 0; } catch { return 0; }
}
function saveBest() {
  try { localStorage.setItem('win11web.shooter.highscore', String(best)); } catch { /* Storage can be unavailable. */ }
}
function tone(frequency, duration = 0.08) {
  if (muted) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = 'triangle'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.035, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
    oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + duration);
  } catch { /* Audio is optional. */ }
}
function resize() {
  const rect = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
  width = rect.width; height = rect.height;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (player) { player.x = Math.min(width - 15, player.x); player.y = Math.min(height - 15, player.y); }
}
function reset() {
  player = { x: width / 2, y: height - 65, speed: 240, spread: 0, shield: 0, invincible: 0, auto: true };
  enemies = []; shots = []; bullets = []; particles = []; drops = []; boss = null;
  stars = Array.from({ length: 80 }, () => ({ x: Math.random() * width, y: Math.random() * height, z: 0.3 + Math.random() * 1.5 }));
  wave = 1; score = 0; lives = 3; bombs = 2; streak = 0; spawnTimer = 0; waveTimer = 0; fireTimer = 0; shake = 0;
  state = 'playing'; $('overlay').hidden = true; last = 0; updateHud();
}
function updateHud() {
  $('score').textContent = `점수 ${score}`; $('wave').textContent = `웨이브 ${wave}`;
  $('lives').textContent = `생명 ${'♥'.repeat(Math.max(0, lives))}`; $('bombs').textContent = `폭탄 ${bombs}`;
  $('multiplier').textContent = `배율 ×${Math.min(5, 1 + Math.floor(streak / 10))}`;
  $('boss').hidden = !boss; if (boss) $('boss-bar').style.width = `${Math.max(0, boss.hp / boss.maxHp * 100)}%`;
}
function overlay(title, message, button) {
  $('heading').textContent = title; $('message').textContent = message; $('start').textContent = button;
  $('best').textContent = `최고 점수 ${best}`; $('overlay').hidden = false;
}
function pause() {
  if (state !== 'playing') return;
  state = 'paused'; keys.clear(); overlay('일시 정지', '준비되면 비행을 계속하세요.', '계속하기');
}
function end() {
  state = 'over'; best = Math.max(best, score); saveBest(); overlay('비행 종료', `최종 점수 ${score} · 웨이브 ${wave}`, '다시 비행');
}
function explosion(x, y, color, count = 12) {
  for (let i = 0; i < count; i++) particles.push({ x, y, vx: (Math.random() - .5) * 180, vy: (Math.random() - .5) * 180, life: .4 + Math.random() * .5, color });
}
function useBomb() {
  if (state !== 'playing' || bombs <= 0) return;
  bombs--; bullets.forEach((b) => explosion(b.x, b.y, '#9fe8ff', 3)); bullets = [];
  enemies.forEach((e) => { e.hp -= 4; }); if (boss) boss.hp -= 12;
  shake = 12; tone(90, .3); updateHud();
}
function spawn() {
  const type = Math.floor(Math.random() * 4);
  enemies.push({ x: 25 + Math.random() * Math.max(1, width - 50), y: -25, type, hp: 1 + (type === 3 ? 2 : 0), t: 0, shot: 1, base: Math.random() * 6 });
}
function enemyBullet(x, y, vx, vy) { bullets.push({ x, y, vx, vy }); }
function update(dt) {
  stars.forEach((s) => { s.y += 25 * s.z * dt; if (s.y > height) { s.y = 0; s.x = Math.random() * width; } });
  player.x += ((keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0)) * player.speed * dt;
  player.y += ((keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('w') ? 1 : 0)) * player.speed * dt;
  player.x = Math.max(14, Math.min(width - 14, player.x)); player.y = Math.max(14, Math.min(height - 14, player.y));
  player.invincible = Math.max(0, player.invincible - dt); fireTimer -= dt;
  if (player.auto && fireTimer <= 0) {
    shots.push({ x: player.x, y: player.y - 14, vx: 0 });
    if (player.spread) { shots.push({ x: player.x, y: player.y, vx: -110 }, { x: player.x, y: player.y, vx: 110 }); }
    fireTimer = .17;
  }
  spawnTimer -= dt; waveTimer += dt;
  if (!boss && wave % 5 === 0) boss = { x: width / 2, y: 75, hp: 35 + wave * 4, maxHp: 35 + wave * 4, t: 0, shot: 0 };
  if (!boss && spawnTimer <= 0) { spawn(); spawnTimer = Math.max(.3, 1.25 - wave * .06); }
  if (!boss && waveTimer > 18) { wave++; waveTimer = 0; }
  if (boss) {
    boss.t += dt; boss.x = width / 2 + Math.sin(boss.t * (boss.hp < boss.maxHp / 2 ? 1.8 : .8)) * width * .3; boss.shot -= dt;
    if (boss.shot <= 0) { const phase = boss.hp < boss.maxHp / 2; for (let i = -2; i <= 2; i++) enemyBullet(boss.x, boss.y + 20, i * (phase ? 65 : 40), phase ? 185 : 130); boss.shot = phase ? .45 : .9; }
    if (boss.hp <= 0) { explosion(boss.x, boss.y, '#ff93cc', 40); score += 1000 * Math.min(5, 1 + Math.floor(streak / 10)); boss = null; wave++; waveTimer = 0; shake = 15; tone(110, .4); }
  }
  enemies.forEach((e) => {
    e.t += dt; e.y += (55 + wave * 3 + e.type * 10) * dt;
    if (e.type === 1) e.x += Math.sin(e.t * 4 + e.base) * 90 * dt;
    if (e.type === 2) e.x += Math.cos(e.t * 2 + e.base) * 65 * dt;
    if (e.type === 3) e.x += Math.sign(player.x - e.x) * 35 * dt;
    e.shot -= dt;
    if (e.shot <= 0) { const dx = player.x - e.x, dy = player.y - e.y, len = Math.hypot(dx, dy) || 1; if (e.type === 0) enemyBullet(e.x, e.y, 0, 140); if (e.type === 1) { enemyBullet(e.x, e.y, -55, 130); enemyBullet(e.x, e.y, 55, 130); } if (e.type === 2) enemyBullet(e.x, e.y, dx / len * 150, dy / len * 150); if (e.type === 3) for (let i = -1; i <= 1; i++) enemyBullet(e.x, e.y, i * 75, 150); e.shot = 1.2 + e.type * .2; }
  });
  shots.forEach((s) => { s.x += s.vx * dt; s.y -= 420 * dt; }); bullets.forEach((b) => { b.x += b.vx * dt; b.y += b.vy * dt; });
  for (const s of shots) {
    for (const e of enemies) if (!s.dead && e.hp > 0 && Math.hypot(s.x - e.x, s.y - e.y) < 18) { s.dead = true; e.hp--; }
    if (!s.dead && boss && Math.abs(s.x - boss.x) < 50 && Math.abs(s.y - boss.y) < 28) { s.dead = true; boss.hp--; }
  }
  enemies.forEach((e) => { if (e.hp <= 0 && !e.dead) { e.dead = true; streak++; score += 100 * Math.min(5, 1 + Math.floor(streak / 10)); explosion(e.x, e.y, '#ffb38b'); if (Math.random() < .16) drops.push({ x: e.x, y: e.y, type: Math.floor(Math.random() * 4) }); tone(300); } });
  if (!player.invincible && (bullets.some((b) => Math.hypot(b.x - player.x, b.y - player.y) < 12) || enemies.some((e) => !e.dead && Math.hypot(e.x - player.x, e.y - player.y) < 22))) {
    bullets = bullets.filter((b) => Math.hypot(b.x - player.x, b.y - player.y) >= 30); if (player.shield) player.shield--; else lives--;
    streak = 0; player.invincible = 2; shake = 10; explosion(player.x, player.y, '#8beaff'); tone(100, .25); if (lives <= 0) end();
  }
  drops.forEach((d) => { d.y += 65 * dt; if (Math.hypot(d.x - player.x, d.y - player.y) < 20) { d.dead = true; if (d.type === 0) player.spread = 1; if (d.type === 1) player.shield++; if (d.type === 2) bombs++; if (d.type === 3) player.speed = Math.min(380, player.speed + 35); tone(700, .15); } });
  particles.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
  shots = shots.filter((s) => !s.dead && s.y > -10); enemies = enemies.filter((e) => !e.dead && e.y < height + 30); bullets = bullets.filter((b) => b.y < height + 20 && b.y > -20 && b.x > -20 && b.x < width + 20); drops = drops.filter((d) => !d.dead && d.y < height + 20); particles = particles.filter((p) => p.life > 0); shake = Math.max(0, shake - dt * 30); updateHud();
}
function draw() {
  ctx.clearRect(0, 0, width, height); ctx.save(); if (shake) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
  ctx.fillStyle = '#071126'; ctx.fillRect(0, 0, width, height);
  stars.forEach((s) => { ctx.fillStyle = `rgba(180,220,255,${s.z / 2})`; ctx.fillRect(s.x, s.y, s.z * 2, s.z * 2); });
  if (player && (!player.invincible || Math.floor(player.invincible * 10) % 2)) { ctx.fillStyle = '#80e8ff'; ctx.beginPath(); ctx.moveTo(player.x, player.y - 16); ctx.lineTo(player.x - 13, player.y + 13); ctx.lineTo(player.x, player.y + 7); ctx.lineTo(player.x + 13, player.y + 13); ctx.fill(); if (player.shield) { ctx.strokeStyle = '#9fe8ff'; ctx.beginPath(); ctx.arc(player.x, player.y, 21, 0, Math.PI * 2); ctx.stroke(); } }
  enemies?.forEach((e) => { ctx.fillStyle = ['#ff9d8d', '#f5c278', '#c39aff', '#ff729e'][e.type]; ctx.beginPath(); ctx.arc(e.x, e.y, 12 + e.type, 0, Math.PI * 2); ctx.fill(); });
  if (boss) { ctx.fillStyle = '#cf70bc'; ctx.beginPath(); ctx.ellipse(boss.x, boss.y, 50, 25, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#a6f6ff'; shots?.forEach((s) => ctx.fillRect(s.x - 2, s.y - 7, 4, 12)); ctx.fillStyle = '#ff7eaa'; bullets?.forEach((b) => { ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill(); });
  drops?.forEach((d) => { ctx.fillStyle = '#83e5b2'; ctx.fillRect(d.x - 10, d.y - 10, 20, 20); ctx.fillStyle = '#10203a'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(['확', '방', '폭', '속'][d.type], d.x, d.y + 5); });
  particles?.forEach((p) => { ctx.fillStyle = p.color; ctx.globalAlpha = Math.min(1, p.life * 2); ctx.fillRect(p.x, p.y, 3, 3); }); ctx.globalAlpha = 1; ctx.restore();
}
function frame(time) { const dt = last ? Math.min(.04, (time - last) / 1000) : 0; last = time; if (state === 'playing') update(dt); draw(); requestAnimationFrame(frame); }
window.addEventListener('resize', resize); window.addEventListener('blur', pause); document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('keydown', (e) => { const key = e.key.length === 1 ? e.key.toLowerCase() : e.key; if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(key)) e.preventDefault(); keys.add(key); if (!e.repeat && key === ' ' && state === 'playing') player.auto = !player.auto; if (!e.repeat && key === 'b') useBomb(); if (!e.repeat && (key === 'Escape' || key === 'p')) pause(); });
window.addEventListener('keyup', (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
canvas.addEventListener('pointerdown', (e) => { if (state === 'playing') { canvas.setPointerCapture(e.pointerId); player.auto = true; movePointer(e); } });
canvas.addEventListener('pointermove', (e) => { if (canvas.hasPointerCapture(e.pointerId) && state === 'playing') movePointer(e); });
function movePointer(e) { const rect = canvas.getBoundingClientRect(); player.x = Math.max(14, Math.min(width - 14, e.clientX - rect.left)); player.y = Math.max(14, Math.min(height - 14, e.clientY - rect.top)); }
$('start').onclick = () => { if (state === 'paused') { state = 'playing'; $('overlay').hidden = true; last = 0; } else reset(); };
$('restart').onclick = reset; $('pause').onclick = pause; $('bomb').onclick = useBomb;
$('sound').onclick = () => { muted = !muted; $('sound').textContent = muted ? '소리 꺼짐' : '소리 켜짐'; };
resize(); $('best').textContent = `최고 점수 ${best}`; requestAnimationFrame(frame);
