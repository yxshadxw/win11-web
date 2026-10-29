import { winner, chooseMove } from './rules.js';
const $ = id => document.getElementById(id);
let board = Array(225).fill(0), moves = [], result = null, paused = false, timer = null, muted = false, audio;
let records = { black:0, white:0, draw:0 };
try { records = { ...records, ...JSON.parse(localStorage.getItem('win11web.omok.records') || '{}') }; muted = localStorage.getItem('win11web.omok.muted') === 'true'; } catch {}
function save() { try { localStorage.setItem('win11web.omok.records', JSON.stringify(records)); localStorage.setItem('win11web.omok.muted', String(muted)); } catch {} }
function sound() {
  if (muted) return;
  try { audio ||= new AudioContext(); const oscillator = audio.createOscillator(), gain = audio.createGain(); oscillator.frequency.value = 440; gain.gain.setValueAtTime(.07, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .09); oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .09); } catch {}
}
function render() {
  $('board').replaceChildren();
  for (let i = 0; i < 225; i++) {
    const x = i % 15, y = Math.floor(i / 15), b = document.createElement('button');
    b.className = 'point' + (x === 0 ? ' left' : '') + (x === 14 ? ' right' : '') + (y === 0 ? ' top' : '') + (y === 14 ? ' bottom' : '') + (moves.at(-1) === i ? ' last' : '') + ($('numbers').checked ? ' numbered' : '') + (result?.line?.includes(i) ? ' winning' : '');
    b.setAttribute('role','gridcell'); b.setAttribute('aria-label', `${y + 1}행 ${x + 1}열 ${board[i] === 1 ? '흑' : board[i] === 2 ? '백' : '빈 자리'}`);
    if (board[i]) { const stone = document.createElement('span'); stone.className = 'stone ' + (board[i] === 1 ? 'black' : 'white'); if ($('numbers').checked) stone.textContent = moves.indexOf(i) + 1; b.append(stone); }
    b.onclick = () => place(i); b.onkeydown = e => { const d = { ArrowLeft:-1, ArrowRight:1, ArrowUp:-15, ArrowDown:15 }[e.key]; if (d !== undefined) { e.preventDefault(); $('board').children[Math.max(0, Math.min(224, i + d))].focus(); } }; $('board').append(b);
  }
  $('status').textContent = paused ? '일시 정지됨 · 화면을 선택하면 계속합니다' : result ? result.color ? `${result.color === 1 ? '흑' : '백'} 승리!` : '무승부' : `${moves.length % 2 ? '백' : '흑'} 차례 · ${moves.length}수`;
  $('record').textContent = `흑 ${records.black}승  ·  백 ${records.white}승  ·  무승부 ${records.draw}`;
  $('sound').textContent = muted ? '소리 끔' : '소리 켬';
}
function place(i) {
  if (paused || result || board[i] || timer || ($('mode').value === 'ai' && moves.length % 2)) return;
  put(i); schedule();
}
function put(i) {
  board[i] = moves.length % 2 + 1; moves.push(i); sound(); result = winner(board, i);
  if (!result && moves.length === 225) result = { color:0, line:[] };
  if (result) { records[result.color === 1 ? 'black' : result.color === 2 ? 'white' : 'draw']++; save(); }
  render();
}
function schedule() {
  if (!paused && !result && $('mode').value === 'ai' && moves.length % 2) timer = setTimeout(() => { timer = null; if (!paused) put(chooseMove(board, 2, Number($('level').value))); }, 150);
}
function cancel() { clearTimeout(timer); timer = null; }
$('restart').onclick = () => { cancel(); board = Array(225).fill(0); moves = []; result = null; paused = false; render(); };
$('undo').onclick = () => { cancel(); if (!moves.length) return; if (result) { records[result.color === 1 ? 'black' : result.color === 2 ? 'white' : 'draw']--; save(); } result = null; const count = $('mode').value === 'ai' && moves.length % 2 === 0 ? 2 : 1; for (let i = 0; i < count && moves.length; i++) board[moves.pop()] = 0; render(); };
$('mode').onchange = () => $('restart').click(); $('numbers').onchange = render; $('sound').onclick = () => { muted = !muted; save(); render(); };
function pause() { paused = true; cancel(); render(); }
window.addEventListener('blur', pause); document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
document.addEventListener('pointerdown', () => { if (paused && !document.hidden) { paused = false; render(); schedule(); } });
document.addEventListener('keydown', () => { if (paused && !document.hidden) { paused = false; render(); schedule(); } });
render();
