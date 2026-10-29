import { songs, events, chart, judge } from './rules.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const keys = ['d', 'f', 'j', 'k'];
let audio, master, state = 'title', muted = false, notes = [], scheduled = 0, startAt = 0, pausedAt = 0;
let score = 0, combo = 0, earned = 0, judged = 0, flash = 0, feedback = '', particles = [];
let width = 0, height = 0, last = 0, accumulator = 0;
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(`win11web.rhythm.${key}`)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(`win11web.rhythm.${key}`, JSON.stringify(value)); } catch {} };
const best = read('best', {});
$('offset').value = read('offset', 0);
songs.forEach((song, i) => $('song').add(new Option(`${song.name} · ${song.bpm} BPM`, i)));
function bestKey() { return `${$('song').value}.${$('difficulty').value}`; }
function showBest() { $('best').textContent = `최고 점수: ${best[bestKey()] || 0}점`; }
showBest();
$('song').onchange = showBest;
$('difficulty').onchange = showBest;
$('offset').onchange = () => { $('offset').value = Math.max(-200, Math.min(200, Number($('offset').value) || 0)); write('offset', Number($('offset').value)); };
function setupAudio() {
  if (!audio) { audio = new AudioContext(); master = audio.createGain(); master.connect(audio.destination); }
  master.gain.value = muted ? 0 : 0.18;
  audio.resume();
}
function tone(event, when) {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const duration = event.type === 'drum' ? 0.09 : event.type === 'bass' ? 0.32 : 0.18;
  oscillator.type = event.type === 'lead' ? 'triangle' : event.type === 'bass' ? 'sine' : 'square';
  oscillator.frequency.setValueAtTime(event.type === 'drum' ? event.pitch : 440 * 2 ** ((event.pitch - 69) / 12), when);
  if (event.type === 'drum') oscillator.frequency.exponentialRampToValueAtTime(40, when + duration);
  gain.gain.setValueAtTime(event.type === 'drum' ? 0.24 : 0.4, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
  oscillator.connect(gain).connect(master); oscillator.start(when); oscillator.stop(when + duration);
}
let music = [];
function begin() {
  setupAudio();
  const song = songs[Number($('song').value)];
  notes = chart(song, $('difficulty').value).map(note => ({ ...note, done: false }));
  music = events(song); scheduled = 0; score = combo = earned = judged = 0; particles = []; feedback = '';
  startAt = audio.currentTime + 2; state = 'playing'; $('overlay').hidden = true;
}
function panel(title, text, selection, button) {
  $('heading').textContent = title; $('message').textContent = text; $('selection').hidden = !selection;
  $('start').textContent = button; $('menu').hidden = selection; $('overlay').hidden = false;
}
function pause() {
  if (state !== 'playing') return;
  state = 'paused'; pausedAt = audio.currentTime; audio.suspend(); panel('일시 정지', '준비가 되면 계속 연주하세요.', false, '계속하기');
}
function resume() { startAt += audio.currentTime - pausedAt; audio.resume(); state = 'playing'; $('overlay').hidden = true; }
function title() { state = 'title'; if (audio) audio.resume(); showBest(); panel('비트 정원', '떨어지는 빛을 박자에 맞춰 눌러 보세요.', true, '연주 시작'); }
function finish() {
  state = 'result'; const accuracy = judged ? earned / judged : 0;
  const grade = accuracy >= .95 ? 'S' : accuracy >= .85 ? 'A' : accuracy >= .7 ? 'B' : 'C';
  best[bestKey()] = Math.max(best[bestKey()] || 0, score); write('best', best);
  panel(`연주 완료 · ${grade}`, `${score}점 · 정확도 ${(accuracy * 100).toFixed(1)}%`, false, '다시 연주');
}
function hit(lane) {
  if (state !== 'playing') return;
  const time = audio.currentTime - startAt - Number($('offset').value) / 1000;
  const target = notes.filter(note => !note.done && note.lane === lane).sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
  if (!target || Math.abs(target.time - time) > .15) return;
  target.done = true; const result = judge(time - target.time); const value = { '완벽': 1, '좋음': .75, '아쉬움': .4 }[result];
  judged++; earned += value; combo++; score += Math.round(value * 1000); feedback = result; flash = 1;
  for (let i = 0; i < 12; i++) particles.push({ x: (lane + .5) / 4, y: .8, vx: (Math.random() - .5) * .4, vy: -Math.random() * .5, life: 1 });
}
function update(dt) {
  flash = Math.max(0, flash - dt * 2); particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 1.5; }); particles = particles.filter(p => p.life > 0);
  if (state !== 'playing') return;
  const time = audio.currentTime - startAt;
  while (scheduled < music.length && startAt + music[scheduled].beat * 60 / songs[Number($('song').value)].bpm < audio.currentTime + .12) {
    const event = music[scheduled++]; const when = startAt + event.beat * 60 / songs[Number($('song').value)].bpm;
    if (when >= audio.currentTime) tone(event, when);
  }
  for (const note of notes) if (!note.done && time - Number($('offset').value) / 1000 > note.time + .15) { note.done = true; judged++; combo = 0; feedback = '놓침'; flash = 1; }
  $('score').textContent = `${score}점`; $('combo').textContent = `${combo} COMBO`; $('accuracy').textContent = `정확도 ${judged ? (earned / judged * 100).toFixed(1) : '100'}%`;
  if (time > 32 * 60 / songs[Number($('song').value)].bpm + 1) finish();
}
function resize() { width = canvas.clientWidth; height = canvas.clientHeight; const dpr = devicePixelRatio || 1; canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
function draw() {
  ctx.clearRect(0, 0, width, height); const laneWidth = Math.min(440, width * .96) / 4; const left = (width - laneWidth * 4) / 2; const line = height - 75;
  const gradient = ctx.createLinearGradient(0, 0, 0, height); gradient.addColorStop(0, '#202e55'); gradient.addColorStop(1, '#0a1025'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#ffffff0c' : '#ffffff16'; ctx.fillRect(left + i * laneWidth, 0, laneWidth - 2, height); }
  ctx.fillStyle = '#c4f5ff'; ctx.fillRect(left, line, laneWidth * 4, 3);
  const now = audio ? audio.currentTime - startAt : 0;
  for (const note of notes) if (!note.done) { const y = line - (note.time - now) * height / 2.2; if (y > -20 && y < height) { ctx.fillStyle = ['#80e5ff', '#9fa8ff', '#f2a8e4', '#ffcf87'][note.lane]; ctx.fillRect(left + note.lane * laneWidth + 5, y - 6, laneWidth - 12, 12); } }
  for (const p of particles) { ctx.globalAlpha = p.life; ctx.fillStyle = '#fff2b4'; ctx.fillRect(left + p.x * laneWidth * 4, p.y * height, 5, 5); } ctx.globalAlpha = 1;
  if (flash) { ctx.globalAlpha = flash; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = 'bold 24px Segoe UI'; ctx.fillText(feedback, width / 2, line - 45); ctx.globalAlpha = 1; }
}
function frame(now) { if (!last) last = now; accumulator += Math.min((now - last) / 1000, .1); last = now; while (accumulator >= 1 / 60) { update(1 / 60); accumulator -= 1 / 60; } draw(); requestAnimationFrame(frame); }
$('start').onclick = () => state === 'paused' ? resume() : begin(); $('menu').onclick = title; $('restart').onclick = begin; $('pause').onclick = () => state === 'paused' ? resume() : pause();
$('sound').onclick = () => { muted = !muted; $('sound').textContent = muted ? '소리 꺼짐' : '소리 켜짐'; if (master) master.gain.value = muted ? 0 : .18; };
document.addEventListener('keydown', e => { if (e.repeat) return; const key = e.key.toLowerCase(); if (keys.includes(key)) { e.preventDefault(); hit(keys.indexOf(key)); } else if (key === 'p' || key === 'escape') { e.preventDefault(); state === 'paused' ? resume() : pause(); } });
document.querySelectorAll('[data-lane]').forEach(button => button.addEventListener('pointerdown', e => { e.preventDefault(); hit(Number(button.dataset.lane)); }));
window.addEventListener('blur', pause); document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); }); window.addEventListener('resize', resize); resize(); requestAnimationFrame(frame);
