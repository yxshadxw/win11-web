import { initial, legalMoves, play, status, notation, nameOf } from './rules.js';
import { Online } from './online.js';
const $ = id => document.getElementById(id);
const shapes = {
  p: '<circle cx="24" cy="14" r="6"/><path d="M17 34c1-6 3-9 7-9s6 3 7 9z"/>',
  r: '<path d="M14 10h5v4h4v-4h4v4h4v-4h4v9l-4 4 2 11H15l2-11-3-4z"/>',
  n: '<path d="M14 34c2-7 4-11 9-15l-4-5 3-5 7 3 5 7-2 15z"/><circle cx="27" cy="17" r="1" fill="currentColor"/>',
  b: '<path d="M24 8c-7 7-8 12-3 16l-5 10h16l-5-10c5-4 4-9-3-16z"/><path d="m23 14 4 5" fill="none"/>',
  q: '<path d="m12 14 5 19h14l5-19-7 8-5-11-5 11z"/><circle cx="12" cy="12" r="2"/><circle cx="24" cy="9" r="2"/><circle cx="36" cy="12" r="2"/>',
  k: '<path d="M24 8v9m-4-5h8M16 19c-3 4 0 8 3 10l-3 5h16l-3-5c3-2 6-6 3-10-3-3-6-1-8 2-2-3-5-5-8-2z"/>'
};
function pieceSvg(piece) {
  const white = piece === piece.toUpperCase();
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="${white ? '#fff9ed' : '#354252'}" stroke="${white ? '#755f4d' : '#19242e'}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${shapes[piece.toLowerCase()]}<path d="M14 34h20l2 5H12z"/></g></svg>`;
}
let state = initial(), snapshots = [], notes = [], selected = -1, flipped = false, worker = null, paused = false, pending = null;
const LABELS = { checkmate:'체크메이트', stalemate:'스테일메이트 · 무승부', fifty:'50수 규칙 · 무승부', repetition:'3회 반복 · 무승부', material:'기물 부족 · 무승부' };

// Online mode: the server's move list is the truth; the board is rebuilt from it on every update.
const online = new Online({
  onState(snap) {
    state = initial(); snapshots = [];
    for (const move of snap.moves) {
      const full = legalMoves(state).find(m => m.from === move.from && m.to === move.to && (m.promotion || null) === (move.promotion || null));
      if (!full) break;
      snapshots.push({ state, move: full }); state = play(state, full);
    }
    notes = snap.notes.slice(); selected = -1; flipped = online.color === 'b';
    renderOnlinePanel(); render();
  },
  onError(message) { $('online-error').textContent = message; },
});

function renderOnlinePanel() {
  const on = $('mode').value === 'online';
  $('online').hidden = !on;
  $('level').closest('label').hidden = on;
  $('undo').hidden = on;
  $('restart').textContent = on ? '재대결' : '새 게임';
  $('online-lobby').hidden = online.active;
  $('online-room').hidden = !online.active;
  $('restart').hidden = on && !online.active;
  if (!online.active) return;
  const snap = online.snap;
  $('room-code').textContent = online.code;
  $('room-role').textContent = online.isPlayer ? `당신은 ${online.color === 'w' ? '백' : '흑'}입니다` : '관전 중입니다';
  const over = snap && snap.status !== 'playing';
  $('resign').hidden = !online.isPlayer || over || !snap?.joined.b;
  $('restart').hidden = !online.isPlayer || !over;
  const asked = snap?.rematch || [];
  $('rematch-note').textContent = over && asked.length === 1
    ? (asked.includes(online.color) ? '상대가 재대결을 수락하길 기다리는 중…' : '상대가 재대결을 원합니다') : '';
}

async function runOnline(action) {
  $('online-error').textContent = '';
  try { await action(); } catch (err) { $('online-error').textContent = err.message; }
  renderOnlinePanel(); render();
}
function stopWorker() { if (worker) worker.terminate(); worker = null; }
function render() {
  const result = status(state), legal = selected < 0 ? [] : legalMoves(state).filter(m => m.from === selected);
  const last = snapshots.at(-1)?.move; $('board').replaceChildren();
  for (let display = 0; display < 64; display++) {
    const i = flipped ? 63 - display : display, piece = state.board[i], button = document.createElement('button');
    button.className = 'square' + ((Math.floor(i / 8) + i % 8) % 2 ? ' dark' : '') + (last && (last.from === i || last.to === i) ? ' last' : '') + (selected === i ? ' selected' : '') + (result.check && piece === (state.turn === 'w' ? 'K' : 'k') ? ' check' : '') + (legal.some(m => m.to === i) ? ' legal' + (piece ? ' capture' : '') : '');
    button.setAttribute('role', 'gridcell'); button.setAttribute('aria-label', `${nameOf(i)} ${piece || '빈 칸'}`); button.dataset.square = i;
    if (piece) button.innerHTML = pieceSvg(piece);
    button.draggable = Boolean(piece); button.addEventListener('dragstart', e => { select(i); e.dataTransfer.setData('text/plain', String(i)); });
    button.addEventListener('dragover', e => e.preventDefault()); button.addEventListener('drop', e => { e.preventDefault(); const from = Number(e.dataTransfer.getData('text/plain')); selected = from; choose(i); });
    button.addEventListener('click', () => choose(i)); button.addEventListener('keydown', e => {
      const delta = { ArrowLeft:-1, ArrowRight:1, ArrowUp:-8, ArrowDown:8 }[e.key];
      if (delta !== undefined) { e.preventDefault(); $('board').children[Math.max(0, Math.min(63, display + delta))].focus(); }
    });
    $('board').append(button);
  }
  $('status').textContent = online.active ? online.describe(LABELS) : paused ? '일시 정지됨 · 화면을 선택하면 계속합니다' : worker ? '컴퓨터가 생각 중입니다…' : LABELS[result.kind] || `${state.turn === 'w' ? '백' : '흑'} 차례${result.check ? ' · 체크' : ''}`;
  $('moves').replaceChildren();
  for (let i = 0; i < notes.length; i += 2) { const li = document.createElement('li'); li.textContent = notes[i] + (notes[i + 1] ? '  ' + notes[i + 1] : ''); $('moves').append(li); }
}
function select(i) { if (state.board[i] && (state.board[i] === state.board[i].toUpperCase() ? 'w' : 'b') === state.turn) selected = i; }
function choose(i) {
  if (online.active ? !online.canMove(state.turn) : paused || worker || status(state).kind !== 'playing') return;
  const moves = legalMoves(state).filter(m => m.from === selected && m.to === i);
  if (moves.length > 1) { pending = moves; $('choices').replaceChildren(); for (const m of moves) { const b = document.createElement('button'); b.className = 'btn'; b.setAttribute('aria-label', {q:'퀸',r:'룩',b:'비숍',n:'나이트'}[m.promotion]); b.innerHTML = pieceSvg(state.turn === 'w' ? m.promotion.toUpperCase() : m.promotion); b.onclick = () => { $('promotion').close(); pending = null; commit(m); }; $('choices').append(b); } $('promotion').showModal(); }
  else if (moves.length) commit(moves[0]); else { selected = -1; select(i); render(); }
}
function commit(move) {
  // Online: send to the server and wait for its update instead of moving locally.
  if (online.active) { selected = -1; render(); runOnline(() => online.send(move)); return; }
  notes.push(notation(state, move)); snapshots.push({ state, move }); state = play(state, move); selected = -1; render(); schedule();
}
function schedule() {
  if (paused || $('mode').value !== 'ai' || state.turn !== 'b' || status(state).kind !== 'playing') return;
  stopWorker(); worker = new Worker('worker.js', { type:'module' });
  worker.onmessage = e => { worker.terminate(); worker = null; if (e.data && !paused) commit(e.data); else render(); };
  worker.postMessage({ state, depth:Number($('level').value) }); render();
}
$('restart').onclick = () => { if (online.active) { runOnline(() => online.rematch()); return; } stopWorker(); state = initial(); snapshots = []; notes = []; selected = -1; paused = false; if ($('promotion').open) $('promotion').close(); render(); };
$('undo').onclick = () => { stopWorker(); if (!snapshots.length) return; const count = $('mode').value === 'ai' && state.turn === 'w' ? 2 : 1; for (let i = 0; i < count && snapshots.length; i++) { state = snapshots.pop().state; notes.pop(); } selected = -1; render(); schedule(); };
$('flip').onclick = () => { flipped = !flipped; render(); };
$('mode').onchange = () => {
  if ($('mode').value !== 'online' && online.active) online.leave();
  flipped = false; renderOnlinePanel(); $('restart').click();
};
$('create-room').onclick = () => runOnline(() => online.create());
$('join-form').onsubmit = (e) => { e.preventDefault(); runOnline(() => online.join($('join-code').value)); };
$('resign').onclick = () => runOnline(() => online.resign());
$('copy-link').onclick = async () => {
  try { await navigator.clipboard.writeText(online.link()); $('copy-link').textContent = '복사됨'; setTimeout(() => { $('copy-link').textContent = '초대 링크 복사'; }, 1500); }
  catch { $('online-error').textContent = online.link(); }
};
$('leave-room').onclick = () => { online.leave(); flipped = false; $('restart').click(); renderOnlinePanel(); };
$('level').onchange = () => { stopWorker(); schedule(); render(); };
$('promotion').addEventListener('cancel', () => { pending = null; selected = -1; render(); });
// Pausing makes no sense against a remote opponent, so online games never pause.
function pause() { if (!paused && !online.active) { paused = true; stopWorker(); render(); } }
window.addEventListener('blur', pause); document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
document.addEventListener('pointerdown', () => { if (paused && !document.hidden) { paused = false; render(); schedule(); } });
document.addEventListener('keydown', () => { if (paused && !document.hidden) { paused = false; render(); schedule(); } });
// An invite link (?room=CODE) opens straight into that room.
const invited = new URLSearchParams(location.search).get('room');
if (invited) { $('mode').value = 'online'; $('join-code').value = invited; runOnline(() => online.join(invited)); }
renderOnlinePanel();
render();
