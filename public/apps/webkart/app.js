import { createTrack, sampleTrack, nearestTrack } from './track.js';

import { createRace, stepRace, ranking as raceRanking, bestLapKey, driftLevel } from './sim.js';

const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const stage = document.querySelector('.stage');
const element = id => document.getElementById(id);
const panels = ['title-panel', 'pause-panel', 'result-panel'];
const controls = { up: false, down: false, left: false, right: false, drift: false };
const touchCapable = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const STEP = 1 / 60;
const COLORS = ['#53d7f3', '#f27b75', '#f4c65e', '#bd9aeb'];
const SPARKS = ['#87dfff', '#ffbd50', '#ef77f7'];

let selectedTrack = 'meadow';
let track = createTrack(selectedTrack);
let race;
let racers = [];
let player;
let state = 'title';
let previousState = 'race';
let countdown = 3.5;
let raceTime = 0;
let lapTime = 0;
let bestTime = 0;
let lastFrame = 0;
let accumulator = 0;
let viewWidth = 0;
let viewHeight = 0;
let camera = { x: 0, y: 0 };
let particles = [];
let marks = [];
let soundMuted = false;
let audioContext;
let engineOscillator;
let engineGain;

function readBest() {
  try {
    return Number(localStorage.getItem(bestLapKey(track.id))) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    localStorage.setItem(bestLapKey(track.id), String(value));
  } catch {
    // Racing remains available when browser storage is disabled.
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--.---';
  const milliseconds = Math.floor(seconds * 1000);
  const minutes = Math.floor(milliseconds / 60000);
  const remainder = Math.floor(milliseconds / 1000) % 60;
  return String(minutes).padStart(2, '0') + ':' +
    String(remainder).padStart(2, '0') + '.' +
    String(milliseconds % 1000).padStart(3, '0');
}

function resize() {
  const rect = stage.getBoundingClientRect();
  viewWidth = Math.max(1, rect.width);
  viewHeight = Math.max(1, rect.height);
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(viewWidth * ratio);
  canvas.height = Math.round(viewHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function showPanel(name) {
  element('overlay').hidden = !name;
  for (const id of panels) element(id).hidden = id !== name;
  if (name) {
    const button = element(name).querySelector('button');
    if (button) button.focus({ preventScroll: true });
  }
}

function clearControls() {
  for (const key of Object.keys(controls)) controls[key] = false;
}


function startRace() {
  track = createTrack(selectedTrack);
  bestTime = readBest();
  race = createRace(selectedTrack);
  track = race.track;
  racers = race.racers;
  player = racers[0];
  camera = { x: player.x, y: player.y };
  particles = [];
  marks = [];
  countdown = 3.5;
  raceTime = 0;
  lapTime = 0;
  state = 'countdown';
  clearControls();
  element('hud').hidden = false;
  element('touch-controls').hidden = !touchCapable;
  element('lights').hidden = false;
  showPanel(null);
  document.title = track.name + ' - 웹카트';
  startAudio();
  updateHud();
}

function titleScreen() {
  state = 'title';
  clearControls();
  element('hud').hidden = true;
  element('lights').hidden = true;
  element('touch-controls').hidden = true;
  track = createTrack(selectedTrack);
  camera = { x: 0, y: 0 };
  document.title = '웹카트';
  showPanel('title-panel');
}

function pauseRace() {
  if (state !== 'race' && state !== 'countdown') return;
  previousState = state;
  state = 'paused';
  clearControls();
  element('touch-controls').hidden = true;
  showPanel('pause-panel');
  updateAudio();
}

function resumeRace() {
  if (state !== 'paused') return;
  state = previousState;
  lastFrame = 0;
  accumulator = 0;
  element('touch-controls').hidden = !touchCapable;
  showPanel(null);
  startAudio();
}

function startAudio() {
  if (soundMuted) return;
  try {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioContext = new AudioContextClass();
      engineOscillator = audioContext.createOscillator();
      engineGain = audioContext.createGain();
      engineOscillator.type = 'sawtooth';
      engineGain.gain.value = 0;
      engineOscillator.connect(engineGain).connect(audioContext.destination);
      engineOscillator.start();
    }
    audioContext.resume();
  } catch {
    // Audio is optional and may be blocked by browser policy.
  }
}

function updateAudio() {
  if (!audioContext || !engineGain) return;
  const running = !soundMuted && state === 'race';
  engineGain.gain.setTargetAtTime(running ? 0.035 : 0, audioContext.currentTime, 0.08);
  engineOscillator.frequency.setTargetAtTime(55 + Math.abs(player?.speed || 0) * 0.5, audioContext.currentTime, 0.08);
}

function boostSound(level) {
  if (!audioContext || soundMuted) return;
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(260 + level * 100, now);
  oscillator.frequency.exponentialRampToValueAtTime(110, now + 0.35);
  gain.gain.setValueAtTime(0.08, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.36);
}


function spawnParticle(x, y, color, size, life, vx = 0, vy = 0) {
  particles.push({ x, y, color, size, life, maxLife: life, vx, vy });
  if (particles.length > 220) particles.shift();
}


function updateEffects(dt) {
  for (const particle of particles) {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.size += dt * 4;
  }
  particles = particles.filter(particle => particle.life > 0);
  for (const mark of marks) mark.life -= dt;
  marks = marks.filter(mark => mark.life > 0);
  if (marks.length > 700) marks.splice(0, marks.length - 700);
}

function update(dt) {
  if (state === 'countdown') {
    countdown -= dt;
    const active = Math.min(3, Math.max(0, Math.floor(3.5 - countdown)));
    document.querySelectorAll('.light-row i').forEach((light, index) => light.classList.toggle('on', index < active));
    element('light-text').textContent = countdown > 0.5 ? '준비' : '출발!';
    if (countdown <= 0) {
      state = 'race';
      element('lights').hidden = true;
    }
  } else if (state === 'race') {
    stepRace(race, dt, controls, { marks, spawnParticle, boostSound });
    raceTime = race.time;
    lapTime = race.lapTime;
    if (race.completedLapTime && (!bestTime || race.completedLapTime < bestTime)) {
      bestTime = race.completedLapTime;
      saveBest(bestTime);
    }
    if (player.finishTime) finishRace();
    updateEffects(dt);
    updateHud();
  }
  if (player && state !== 'title') {
    const lead = Math.max(0, player.speed) * 0.3;
    const targetX = player.x + Math.cos(player.angle) * lead;
    const targetY = player.y + Math.sin(player.angle) * lead;
    camera.x += (targetX - camera.x) * Math.min(1, dt * 3);
    camera.y += (targetY - camera.y) * Math.min(1, dt * 3);
  }
  updateAudio();
}

function ranking() {
  return raceRanking(race);
}

function updateHud() {
  const place = ranking().indexOf(player) + 1;
  element('position').innerHTML = place + '<small> / 4</small>';
  element('lap').textContent = Math.min(3, player.laps + 1) + ' / 3';
  element('lap-time').textContent = formatTime(lapTime) === '--:--.---' ? '00:00.000' : formatTime(lapTime);
  element('best-time').textContent = formatTime(bestTime);
  const level = driftLevel(player.charge);
  element('boost-label').textContent = level + '단계';
  element('boost-fill').style.width = Math.min(100, player.charge / 2.7 * 100) + '%';
  element('boost-fill').style.background = SPARKS[Math.max(0, level - 1)];
}

function finishRace() {
  state = 'finished';
  clearControls();
  element('touch-controls').hidden = true;
  const ordered = ranking();
  element('result-subtitle').textContent = track.name + ' · ' + (ordered.indexOf(player) + 1) + '위로 완주했어요';
  const results = element('results');
  results.replaceChildren();
  ordered.forEach((racer, index) => {
    const row = document.createElement('div');
    row.className = 'result-row';
    const rank = document.createElement('strong');
    rank.textContent = (index + 1) + '위';
    const name = document.createElement('span');
    const dot = document.createElement('i');
    dot.className = 'dot';
    dot.style.background = racer.color;
    name.append(dot, document.createTextNode(racer.name));
    const time = document.createElement('span');
    time.textContent = racer.finishTime ? formatTime(racer.finishTime) : '주행 중';
    row.append(rank, name, time);
    results.append(row);
  });
  document.title = '레이스 결과 - 웹카트';
  showPanel('result-panel');
}

function pathTrack() {
  ctx.beginPath();
  track.points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.closePath();
}

function strokeTrack(width, color, dash = []) {
  pathTrack();
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.setLineDash(dash);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawGround() {
  ctx.fillStyle = track.ground;
  ctx.fillRect(camera.x - viewWidth * 3, camera.y - viewHeight * 3, viewWidth * 6, viewHeight * 6);
  // A deterministic pattern gives the fields texture without external assets.
  for (let x = -1200; x <= 1200; x += 100) {
    for (let y = -900; y <= 900; y += 100) {
      if ((x / 100 + y / 100) % 2 === 0) {
        ctx.fillStyle = track.field;
        ctx.globalAlpha = 0.18;
        ctx.fillRect(x, y, 100, 100);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function drawScenery() {
  for (let i = 0; i < track.points.length; i += 12) {
    const point = track.points[i];
    for (const side of [-1, 1]) {
      const offset = 220 + (i * 17 % 80);
      const x = point.x - Math.sin(point.angle) * offset * side;
      const y = point.y + Math.cos(point.angle) * offset * side;
      if (nearestTrack(track, x, y).distance < 190) continue;
      ctx.fillStyle = '#00000020';
      ctx.beginPath();
      ctx.ellipse(x + 5, y + 7, 20, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      if (i % 36 === 0) {
        ctx.fillStyle = '#303d42';
        for (let n = 0; n < 3; n++) {
          ctx.beginPath();
          ctx.arc(x + n * 12 - 12, y, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#738087';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = i % 24 ? '#346f55' : '#407f5d';
        ctx.beginPath();
        ctx.arc(x, y, 19 + i % 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff18';
        ctx.beginPath();
        ctx.arc(x - 5, y - 7, 10, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const stand = sampleTrack(track, track.length * 0.06, -235);
  ctx.save();
  ctx.translate(stand.x, stand.y);
  ctx.rotate(stand.angle);
  ctx.fillStyle = '#68747b';
  ctx.fillRect(-70, -24, 140, 48);
  ctx.fillStyle = '#d9e0dd';
  for (let i = 0; i < 4; i++) ctx.fillRect(-65, -19 + i * 10, 130, 4);
  ctx.fillStyle = '#e7a568';
  for (let i = 0; i < 20; i++) {
    ctx.beginPath();
    ctx.arc(-60 + i % 10 * 13, -14 + Math.floor(i / 10) * 20, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawRoad() {
  strokeTrack(track.width + 16, '#ece7d8');
  strokeTrack(track.width + 9, '#d26359', [16, 16]);
  strokeTrack(track.width, track.road);
  strokeTrack(2, '#d3dbd455', [20, 24]);
  for (const fraction of track.pads) {
    const point = sampleTrack(track, fraction * track.length);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(point.angle);
    ctx.fillStyle = '#20b6d4';
    ctx.fillRect(-17, -38, 34, 76);
    ctx.strokeStyle = '#c0faff';
    ctx.lineWidth = 4;
    for (let y = -23; y <= 23; y += 23) {
      ctx.beginPath();
      ctx.moveTo(-7, y - 7);
      ctx.lineTo(3, y);
      ctx.lineTo(-7, y + 7);
      ctx.stroke();
    }
    ctx.restore();
  }
  const start = sampleTrack(track, 0);
  ctx.save();
  ctx.translate(start.x, start.y);
  ctx.rotate(start.angle);
  for (let x = 0; x < 2; x++) {
    for (let y = 0; y < 10; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#26343a' : '#f8f8ee';
      ctx.fillRect(-10 + x * 10, -75 + y * 15, 10, 15);
    }
  }
  ctx.restore();
}

function drawKart(racer, isPlayer) {
  ctx.save();
  ctx.translate(racer.x, racer.y);
  ctx.rotate(racer.angle);
  ctx.fillStyle = '#17232955';
  ctx.beginPath();
  ctx.ellipse(3, 5, 19, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#202b31';
  for (const x of [-11, 8]) for (const y of [-12, 8]) ctx.fillRect(x, y, 9, 5);
  ctx.fillStyle = racer.color;
  ctx.beginPath();
  ctx.roundRect(-17, -10, 34, 20, 7);
  ctx.fill();
  ctx.fillStyle = '#ffffff55';
  ctx.fillRect(8, -7, 5, 14);
  ctx.fillStyle = '#253c4a';
  ctx.beginPath();
  ctx.arc(-3, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#eaf4f2';
  ctx.beginPath();
  ctx.arc(-2, -1, 4, 0, Math.PI * 2);
  ctx.fill();
  if (isPlayer) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-22, -16);
    ctx.lineTo(-16, -16);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMinimap() {
  const width = Math.min(150, viewWidth * 0.28);
  const height = width * 0.64;
  const x = viewWidth - width - 16;
  const y = viewHeight - height - 16;
  ctx.save();
  ctx.fillStyle = '#14262eb8';
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 10);
  ctx.fill();
  ctx.translate(x + width / 2, y + height / 2);
  const scale = Math.min(width / 1900, height / 1150);
  ctx.scale(scale, scale);
  strokeTrack(55, '#ffffffa6');
  for (const racer of racers) {
    ctx.fillStyle = racer.color;
    ctx.strokeStyle = '#1c3038';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(racer.x, racer.y, racer === player ? 65 : 45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();
  }
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, viewWidth, viewHeight);
  const scale = state === 'title' ? Math.min(viewWidth / 2100, viewHeight / 1400) : Math.max(0.48, Math.min(0.85, viewWidth / 1000));
  ctx.save();
  ctx.translate(viewWidth / 2, viewHeight / 2);
  ctx.scale(scale, scale);
  ctx.translate(-camera.x, -camera.y);
  drawGround();
  drawScenery();
  drawRoad();
  for (const mark of marks) {
    ctx.save();
    ctx.translate(mark.x, mark.y);
    ctx.rotate(mark.angle);
    ctx.globalAlpha = Math.min(0.35, mark.life / 6 * 0.35);
    ctx.fillStyle = '#172327';
    ctx.fillRect(-4, -2, 8, 4);
    ctx.restore();
  }
  for (const particle of particles) {
    ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (state !== 'title') racers.forEach((racer, index) => drawKart(racer, index === 0));
  ctx.restore();
  if (state !== 'title' && racers.length) drawMinimap();
}

function frame(time) {
  const elapsed = lastFrame ? Math.min(0.1, (time - lastFrame) / 1000) : 0;
  lastFrame = time;
  accumulator += elapsed;
  while (accumulator >= STEP) {
    update(STEP);
    accumulator -= STEP;
  }
  draw();
  requestAnimationFrame(frame);
}

const keyMap = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', Shift: 'drift', ' ': 'drift'
};
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' || event.key.toLowerCase() === 'p') {
    if (!event.repeat) {
      if (state === 'paused') resumeRace();
      else pauseRace();
    }
    event.preventDefault();
    return;
  }
  const key = keyMap[event.key] || keyMap[event.key.toLowerCase()];
  if (key && (state === 'race' || state === 'countdown')) {
    event.preventDefault();
    controls[key] = true;
  }
});
window.addEventListener('keyup', event => {
  const key = keyMap[event.key] || keyMap[event.key.toLowerCase()];
  if (key) controls[key] = false;
});
document.querySelectorAll('[data-control]').forEach(button => {
  const key = button.dataset.control;
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    controls[key] = true;
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, () => { controls[key] = false; });
  }
});
document.querySelectorAll('[data-track]').forEach(button => {
  button.addEventListener('click', () => {
    selectedTrack = button.dataset.track;
    track = createTrack(selectedTrack);
    document.querySelectorAll('[data-track]').forEach(option => {
      const selected = option === button;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-pressed', String(selected));
    });
  });
});
element('start').addEventListener('click', startRace);
element('restart').addEventListener('click', startRace);
element('pause-restart').addEventListener('click', startRace);
element('race-again').addEventListener('click', startRace);
element('pause').addEventListener('click', () => state === 'paused' ? resumeRace() : pauseRace());
element('resume').addEventListener('click', resumeRace);
element('pause-title').addEventListener('click', titleScreen);
element('result-title').addEventListener('click', titleScreen);
element('sound').addEventListener('click', () => {
  soundMuted = !soundMuted;
  element('sound').setAttribute('aria-label', soundMuted ? '소리 켜기' : '소리 끄기');
  element('sound').title = soundMuted ? '소리 켜기' : '소리 끄기';
  element('sound').querySelector('span').textContent = soundMuted ? '음소거' : '소리';
  if (!soundMuted) startAudio();
  updateAudio();
});
window.addEventListener('blur', pauseRace);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseRace(); });
window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);

