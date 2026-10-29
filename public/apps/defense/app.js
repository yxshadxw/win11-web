import { TOWERS, ENEMIES, chooseTarget, damageEnemy, wavePlan } from './rules.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const maps = [
  { name: '이슬 숲', color: '#a8d6b2', path: [[0,1],[4,1],[4,3],[1,3],[1,5],[7,5],[7,2],[9,2]] },
  { name: '노을 협곡', color: '#e5c19e', path: [[0,3],[2,3],[2,1],[6,1],[6,4],[3,4],[3,6],[8,6],[8,3],[9,3]] },
  { name: '달빛 정원', color: '#a5bdd8', path: [[0,5],[3,5],[3,2],[1,2],[1,0],[6,0],[6,4],[8,4],[8,1],[9,1]] }
];
let state = 'title', mapIndex = 0, towers = [], enemies = [], effects = [], projectiles = [];
let gold = 180, lives = 20, wave = 0, queue = [], waveTime = 0, active = false, speed = 1;
let chosen = 'arrow', selected = null, cursor = { x: 0, y: 0 }, hover = null, muted = false, audio, shake = 0;
let last = 0, accumulator = 0, nextId = 0, uiSignature = '';
const modes = ['first', 'last', 'strongest', 'closest'];
const modeNames = ['선두', '후미', '최강', '가까운 적'];

function storageRead(key, fallback) { try { return JSON.parse(localStorage.getItem('win11web.defense.' + key)) ?? fallback; } catch { return fallback; } }
function storageWrite(key, value) { try { localStorage.setItem('win11web.defense.' + key, JSON.stringify(value)); } catch {} }
let stars = storageRead('stars', [0, 0, 0]);
function tone(frequency = 440, duration = 0.06) {
  if (muted) return;
  try {
    audio ||= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.035, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
    oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + duration);
  } catch {}
}
function pathCells() {
  const points = maps[mapIndex].path, cells = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x, y] = points[i], [nx, ny] = points[i + 1];
    const length = Math.abs(nx - x) + Math.abs(ny - y);
    for (let j = 0; j < length; j++) cells.push([x + Math.sign(nx - x) * j, y + Math.sign(ny - y) * j]);
  }
  cells.push(points.at(-1)); return cells;
}
function position(enemy) {
  const cells = pathCells(), i = Math.min(Math.floor(enemy.progress), cells.length - 1), t = enemy.progress - i;
  const a = cells[i], b = cells[Math.min(i + 1, cells.length - 1)];
  enemy.x = a[0] + (b[0] - a[0]) * t + 0.5; enemy.y = a[1] + (b[1] - a[1]) * t + 0.5;
}
function spawn(type, progress = 0, small = false) {
  const spec = ENEMIES[type], scale = 1 + (wave - 1) * 0.12;
  const enemy = { ...spec, type, id: nextId++, hp: spec.hp * scale * (small ? 0.35 : 1), maxHp: spec.hp * scale * (small ? 0.35 : 1), progress, slowTime: 0, small };
  position(enemy); enemies.push(enemy);
}
function startGame() {
  mapIndex = Number($('map').value); towers = []; enemies = []; effects = []; projectiles = []; gold = 180; lives = 20; wave = 0; queue = []; active = false; selected = null; state = 'playing';
  $('overlay').hidden = true; updateUI(); tone(550);
}
function showTitle() {
  state = 'title'; $('overlay').hidden = false; $('overlay-title').textContent = '수호의 탑'; $('overlay-text').textContent = '구불구불한 길을 따라 몰려오는 적으로부터 수정 마을을 지켜 주세요.';
  $('map-options').hidden = false; $('stars').textContent = maps.map((map, i) => `${map.name} ${'★'.repeat(stars[i])}${'☆'.repeat(3 - stars[i])}`).join(' · ');
  $('start').hidden = false; $('start').textContent = '시작하기'; $('resume').hidden = true; $('title').hidden = true;
}
function pause() {
  if (state !== 'playing') return;
  state = 'paused'; $('overlay').hidden = false; $('overlay-title').textContent = '일시 정지'; $('overlay-text').textContent = '준비가 되면 방어를 계속하세요.'; $('map-options').hidden = true; $('start').hidden = true; $('resume').hidden = false; $('title').hidden = false;
}
function resume() { if (state === 'paused') { state = 'playing'; $('overlay').hidden = true; last = 0; } }
function finish(clear) {
  state = 'result'; active = false;
  let rating = lives >= 15 ? 3 : lives >= 8 ? 2 : 1;
  if (clear) { stars[mapIndex] = Math.max(stars[mapIndex], rating); storageWrite('stars', stars); }
  $('overlay').hidden = false; $('overlay-title').textContent = clear ? '마을을 지켰습니다!' : '수정이 무너졌습니다';
  $('overlay-text').textContent = clear ? `${maps[mapIndex].name} 완료 · ${'★'.repeat(rating)}${'☆'.repeat(3 - rating)} · 남은 생명 ${lives}` : `${wave}번째 웨이브에서 패배했습니다. 다른 조합으로 다시 도전하세요.`;
  $('map-options').hidden = true; $('start').hidden = false; $('start').textContent = '다시 시작'; $('resume').hidden = true; $('title').hidden = false; tone(clear ? 700 : 150, 0.3);
}
function updateUI() {
  const signature = JSON.stringify([wave, gold, lives, active, state, chosen, selected && [selected.cellX, selected.cellY, selected.level, selected.mode, selected.spent]]);
  if (signature === uiSignature) return;
  uiSignature = signature;
  $('wave').textContent = `${wave} / 20`; $('gold').textContent = gold; $('lives').textContent = lives;
  const plan = wavePlan(Math.min(20, wave + 1));
  const counts = {}; plan.forEach(item => counts[item.type] = (counts[item.type] || 0) + 1);
  $('preview').textContent = wave >= 20 ? '마지막 웨이브 진행 중' : Object.entries(counts).map(([type, count]) => `${ENEMIES[type].name} ${count}`).join(' · ');
  $('next').disabled = active || wave >= 20 || state !== 'playing';
  $('next').textContent = wave === 0 ? '첫 웨이브 시작' : '다음 웨이브 시작 · +10 골드';
  document.querySelectorAll('[data-tower]').forEach(button => button.classList.toggle('active', button.dataset.tower === chosen));
  const box = $('selection');
  if (!selected) { box.textContent = '타워를 선택하면 강화와 목표 설정을 할 수 있습니다.'; return; }
  const spec = TOWERS[selected.type], cost = Math.round(spec.cost * (0.7 + selected.level * 0.3));
  box.innerHTML = `<strong>${spec.name} 타워 · ${selected.level}단계</strong><span>공격력 ${Math.round(spec.damage * (1 + (selected.level - 1) * 0.65))} · 사거리 ${(spec.range + (selected.level - 1) * 0.2).toFixed(1)}</span><button class="btn" id="target">목표: ${modeNames[modes.indexOf(selected.mode)]}</button><button class="btn" id="upgrade" ${selected.level >= 3 ? 'disabled' : ''}>${selected.level >= 3 ? '최대 단계' : `강화 · ${cost} 골드`}</button><button class="btn" id="sell">판매 · ${Math.floor(selected.spent * 0.7)} 골드</button>`;
  $('target').onclick = () => { selected.mode = modes[(modes.indexOf(selected.mode) + 1) % modes.length]; updateUI(); };
  $('upgrade').onclick = () => { if (gold < cost) return notify('골드가 부족합니다.'); gold -= cost; selected.spent += cost; selected.level++; tone(650); updateUI(); };
  $('sell').onclick = () => { gold += Math.floor(selected.spent * 0.7); towers = towers.filter(t => t !== selected); selected = null; tone(300); updateUI(); };
}
function notify(text) { $('message').textContent = text; }
function startWave() {
  if (state !== 'playing' || active || wave >= 20) return;
  if (wave > 0) gold += 10;
  wave++; queue = wavePlan(wave); waveTime = 0; active = true; notify(`${wave}번째 웨이브가 시작되었습니다.`); tone(500); updateUI();
}
function selectCell(x, y) {
  if (state !== 'playing' || x < 0 || x > 9 || y < 0 || y > 6) return;
  cursor = { x, y }; selected = towers.find(t => t.cellX === x && t.cellY === y) || null;
  if (!selected) {
    if (pathCells().some(cell => cell[0] === x && cell[1] === y)) return notify('길 위에는 타워를 지을 수 없습니다.');
    const spec = TOWERS[chosen]; if (gold < spec.cost) return notify('골드가 부족합니다.');
    gold -= spec.cost; selected = { type: chosen, cellX: x, cellY: y, x: x + 0.5, y: y + 0.5, level: 1, spent: spec.cost, cooldown: 0, mode: 'first' }; towers.push(selected); tone(600); notify(`${spec.name} 타워를 세웠습니다.`);
  }
  updateUI();
}
function hit(enemy, amount, pierce) {
  if (enemy.hp <= 0) return;
  enemy.hp = damageEnemy(enemy, amount, pierce); effects.push({ x: enemy.x, y: enemy.y, life: 0.35, color: enemy.color });
  if (enemy.hp <= 0) { gold += enemy.reward; shake = 0.12; if (enemy.type === 'splitter' && !enemy.small) { spawn('basic', enemy.progress, true); spawn('basic', Math.max(0, enemy.progress - 0.3), true); } }
}
function update(dt) {
  if (active) {
    waveTime += dt;
    while (queue.length && queue[0].time <= waveTime) spawn(queue.shift().type);
  }
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    e.slowTime = Math.max(0, e.slowTime - dt); e.progress += e.speed * dt * (e.slowTime ? 0.55 : 1); position(e);
    if (e.type === 'healer') for (const other of enemies) if (other !== e && other.hp > 0 && Math.hypot(e.x - other.x, e.y - other.y) < 1.2) other.hp = Math.min(other.maxHp, other.hp + 3 * dt);
    if (e.progress >= pathCells().length - 1) { e.hp = 0; lives -= e.type === 'boss' ? 5 : 1; shake = 0.3; tone(160); }
  }
  for (const tower of towers) {
    const spec = TOWERS[tower.type]; tower.cooldown -= dt;
    const target = chooseTarget({ ...tower, range: spec.range + (tower.level - 1) * 0.2, antiAir: spec.antiAir }, enemies, tower.mode);
    if (target && tower.cooldown <= 0) {
      tower.cooldown = spec.rate; const damage = spec.damage * (1 + (tower.level - 1) * 0.65);
      projectiles.push({ x: tower.x, y: tower.y, tx: target.x, ty: target.y, life: 0.18, color: spec.color });
      hit(target, damage, spec.pierce); if (spec.slow) target.slowTime = 2;
      if (spec.splash || spec.chain) {
        const nearby = enemies.filter(e => e !== target && e.hp > 0 && (!e.flying || spec.antiAir) && Math.hypot(e.x - target.x, e.y - target.y) < (spec.splash || 1.5));
        for (const e of nearby.slice(0, spec.chain ? 2 : undefined)) { hit(e, damage * 0.5, false); if (spec.chain) projectiles.push({ x: target.x, y: target.y, tx: e.x, ty: e.y, life: 0.18, color: spec.color }); }
      }
    }
  }
  enemies = enemies.filter(e => e.hp > 0); effects.forEach(e => e.life -= dt); effects = effects.filter(e => e.life > 0); projectiles.forEach(p => p.life -= dt); projectiles = projectiles.filter(p => p.life > 0); shake = Math.max(0, shake - dt);
  if (lives <= 0) { lives = 0; finish(false); }
  else if (active && !queue.length && !enemies.length) { active = false; gold += Math.min(20, Math.floor(gold * 0.05)); if (wave === 20) finish(true); else notify('웨이브 완료! 이자가 지급되었습니다.'); }
  updateUI();
}
function draw() {
  const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  ctx.setTransform(width / 10, 0, 0, height / 7, 0, 0); ctx.clearRect(0, 0, 10, 7);
  ctx.save(); if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  ctx.fillStyle = maps[mapIndex].color; ctx.fillRect(0, 0, 10, 7);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 10; x++) { ctx.fillStyle = (x + y) % 2 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.025)'; ctx.fillRect(x + .025, y + .025, .95, .95); }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#d9c7a9'; ctx.lineWidth = .78; ctx.beginPath(); maps[mapIndex].path.forEach(([x,y], i) => i ? ctx.lineTo(x + .5,y + .5) : ctx.moveTo(x + .5,y + .5)); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = .04; ctx.setLineDash([.15,.15]); ctx.stroke(); ctx.setLineDash([]);
  const rangeTower = selected || (hover && { x: hover.x + .5, y: hover.y + .5, type: chosen, level: 1 });
  if (rangeTower) { ctx.beginPath(); ctx.arc(rangeTower.x, rangeTower.y, TOWERS[rangeTower.type].range + (rangeTower.level - 1) * .2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(31,100,190,.12)'; ctx.fill(); ctx.strokeStyle = 'rgba(31,100,190,.5)'; ctx.lineWidth = .04; ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = .04; ctx.strokeRect(cursor.x + .06, cursor.y + .06, .88, .88);
  for (const t of towers) { const spec = TOWERS[t.type]; ctx.fillStyle = 'rgba(20,40,60,.22)'; ctx.beginPath(); ctx.arc(t.x, t.y + .08, .38, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = spec.color; ctx.beginPath(); ctx.arc(t.x, t.y, .3, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold .23px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(t.level), t.x, t.y + .08); }
  for (const e of enemies) { ctx.fillStyle = e.color; ctx.beginPath(); ctx.arc(e.x, e.y, e.type === 'boss' ? .32 : e.small ? .13 : .21, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#263348'; ctx.fillRect(e.x - .23, e.y - .34, .46, .05); ctx.fillStyle = '#9ef5b5'; ctx.fillRect(e.x - .23, e.y - .34, .46 * e.hp / e.maxHp, .05); }
  for (const p of projectiles) { ctx.strokeStyle = p.color; ctx.lineWidth = .09; ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.tx,p.ty); ctx.stroke(); }
  for (const e of effects) { ctx.strokeStyle = e.color; ctx.lineWidth = .06; ctx.beginPath(); ctx.arc(e.x,e.y,.1 + (0.35 - e.life),0,Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}
function frame(time) {
  if (!last) last = time; const elapsed = Math.min((time - last) / 1000, .1); last = time;
  if (state === 'playing') { accumulator += elapsed * speed; while (accumulator >= 1 / 60) { update(1 / 60); accumulator -= 1 / 60; if (state !== 'playing') break; } } else accumulator = 0;
  draw(); requestAnimationFrame(frame);
}
for (const [type, spec] of Object.entries(TOWERS)) { const button = document.createElement('button'); button.className = 'btn'; button.dataset.tower = type; button.innerHTML = `<span class="dot" style="background:${spec.color}"></span><span>${spec.name}<br>${spec.cost}G</span>`; button.onclick = () => { chosen = type; selected = null; updateUI(); }; $('towers').append(button); }
function cellFromEvent(event) { const rect = canvas.getBoundingClientRect(); return { x: Math.floor((event.clientX - rect.left) / rect.width * 10), y: Math.floor((event.clientY - rect.top) / rect.height * 7) }; }
canvas.addEventListener('pointermove', event => { hover = cellFromEvent(event); }); canvas.addEventListener('pointerleave', () => { hover = null; }); canvas.addEventListener('pointerdown', event => { const cell = cellFromEvent(event); selectCell(cell.x, cell.y); });
window.addEventListener('keydown', event => { if (event.key === 'Escape' || event.key.toLowerCase() === 'p') { if (state === 'playing') pause(); else resume(); return; } if (state !== 'playing' || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter'].includes(event.key)) return; event.preventDefault(); if (event.key === 'Enter') selectCell(cursor.x, cursor.y); else { cursor.x = Math.max(0, Math.min(9, cursor.x + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0))); cursor.y = Math.max(0, Math.min(6, cursor.y + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0))); hover = cursor; } });
window.addEventListener('blur', pause); document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
$('start').onclick = startGame; $('resume').onclick = resume; $('title').onclick = showTitle; $('pause').onclick = pause; $('restart').onclick = startGame; $('next').onclick = startWave;
$('speed').onclick = () => { speed = speed === 1 ? 2 : 1; $('speed').textContent = `${speed}배속`; };
$('sound').onclick = () => { muted = !muted; $('sound').textContent = muted ? '소리 꺼짐' : '소리 켜짐'; if (!muted) tone(); };
showTitle(); updateUI(); requestAnimationFrame(frame);
