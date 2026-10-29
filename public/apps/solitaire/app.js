import { newGame, draw, move, findMoves, isWon } from './rules.js';

const $ = selector => document.querySelector(selector);
const board = $('#board');
const message = $('#message');
const settings = $('#settings-dialog');
const winDialog = $('#win-dialog');
const symbols = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };
const suitNames = { clubs: '클로버', diamonds: '다이아몬드', hearts: '하트', spades: '스페이드' };
const key = name => `win11web.solitaire.${name}`;
function read(name, fallback) {
  try { return JSON.parse(localStorage.getItem(key(name))) ?? fallback; } catch { return fallback; }
}
function save(name, value) {
  try { localStorage.setItem(key(name), JSON.stringify(value)); } catch { /* Storage is optional. */ }
}
let stats = read('stats', { played: 0, won: 0, best: null });
let options = read('options', { draw: 1, back: 'blue' });
let game, history = [], selected = null, hint = null, paused = false, won = false;
let elapsed = 0, lastTick = Date.now(), animation = 0;

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function startGame() {
  clearTimeout(animation);
  if (winDialog.open) winDialog.close();
  game = newGame(); history = []; selected = null; hint = null; elapsed = 0; won = false; paused = false;
  lastTick = Date.now(); stats.played++; save('stats', stats);
  message.textContent = '카드를 선택하거나 끌어 놓으세요.';
  render();
}
function remember() { history.push(JSON.stringify(game)); }
function undo() {
  if (paused || won || !history.length) return;
  clearTimeout(animation); game = JSON.parse(history.pop()); selected = null; hint = null;
  message.textContent = '이전 이동을 되돌렸습니다.'; render();
}
function attempt(source, target) {
  if (paused || won) return false;
  remember();
  if (!move(game, source, target)) { history.pop(); return false; }
  selected = null; hint = null;
  message.textContent = '이동했습니다.';
  render(); checkWin(); return true;
}
function checkWin() {
  if (!isWon(game) || won) return;
  won = true; stats.won++; stats.best = stats.best === null ? elapsed : Math.min(stats.best, elapsed); save('stats', stats);
  board.classList.add('win-animation');
  $('#win-text').textContent = `${formatTime(elapsed)} · ${game.moves}회 이동 · ${game.score}점`;
  animation = setTimeout(() => winDialog.showModal(), 900);
}
function autoFoundation(source) {
  const candidate = findMoves(game).find(item => item.source.type === source.type && item.source.index === source.index && item.source.card === source.card && item.target.type === 'foundations');
  return candidate ? attempt(candidate.source, candidate.target) : false;
}
function same(a, b) { return a && b && a.type === b.type && a.index === b.index && a.card === b.card; }
function activate(source) {
  if (paused || won) return;
  if (selected) {
    const target = { type: source.type, index: source.index };
    if (target.type !== 'waste' && attempt(selected, target)) return;
    if (same(selected, source)) { selected = null; render(); return; }
  }
  if (autoFoundation(source)) return;
  selected = source; hint = null; message.textContent = '이동할 위치를 선택하세요.'; render();
}
function slot(type, index, x, y, label) {
  const element = document.createElement('button');
  element.className = 'slot'; element.type = 'button'; element.dataset.type = type; element.dataset.index = index;
  element.style.left = `calc((var(--card-w) + var(--gap)) * ${x})`; element.style.top = y;
  element.setAttribute('aria-label', label); element.textContent = type === 'stock' ? '↻' : type === 'foundations' ? '♧' : '';
  if (hint && hint.target.type === type && hint.target.index === index) element.classList.add('hint');
  element.onclick = () => {
    if (paused || won) return;
    if (type === 'stock') { remember(); if (!draw(game, Number(options.draw))) history.pop(); selected = null; hint = null; render(); }
    else if (selected) attempt(selected, { type, index });
  };
  board.append(element);
}
function makeCard(card, source, x, y, z) {
  const element = document.createElement('button');
  element.type = 'button'; element.className = `playing-card ${card.faceUp ? (card.suit === 'hearts' || card.suit === 'diamonds' ? 'red' : '') : 'back'}`;
  element.style.left = `calc((var(--card-w) + var(--gap)) * ${x})`; element.style.top = y; element.style.zIndex = z; element.style.setProperty('--delay', z);
  element.dataset.type = source.type; element.dataset.index = source.index ?? ''; element.dataset.card = source.card ?? '';
  element.setAttribute('aria-label', card.faceUp ? `${suitNames[card.suit]} ${card.rank}` : '뒤집힌 카드');
  if (card.faceUp) {
    const rank = ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' })[card.rank] || card.rank;
    element.innerHTML = `<span class="corner">${rank}<span>${symbols[card.suit]}</span></span><span class="pip">${symbols[card.suit]}</span>`;
  }
  if (same(selected, source)) element.classList.add('selected');
  if (hint && same(hint.source, source)) element.classList.add('hint');
  if (card.faceUp) {
    element.onclick = () => activate(source);
    element.ondblclick = event => { event.preventDefault(); autoFoundation(source); };
    element.onpointerdown = event => beginDrag(event, element, source);
  }
  board.append(element);
}
function beginDrag(event, element, source) {
  if (paused || won || event.button !== 0) return;
  const startX = event.clientX, startY = event.clientY;
  let dragging = false;
  element.setPointerCapture(event.pointerId);
  element.onpointermove = e => {
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.hypot(dx, dy) > 5) dragging = true;
    if (dragging) { element.classList.add('dragging'); element.style.transform = `translate(${dx}px, ${dy}px)`; element.style.zIndex = 1000; }
  };
  element.onpointerup = e => {
    element.onpointermove = null; element.onpointerup = null;
    if (!dragging) return;
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-type]');
    const target = under && { type: under.dataset.type, index: Number(under.dataset.index) };
    element.onclick = e2 => { e2.preventDefault(); e2.stopPropagation(); };
    if (!target || !['tableau', 'foundations'].includes(target.type) || !attempt(source, target)) render();
  };
  element.onpointercancel = () => render();
}
function render() {
  board.replaceChildren(); board.dataset.back = options.back; board.classList.toggle('win-animation', won);
  const top = '22px', lower = 'calc(22px + var(--card-h) + var(--gap) * 2)';
  slot('stock', 0, 0, top, '카드 뽑기 또는 다시 놓기');
  if (game.stock.length) {
    const back = document.createElement('span'); back.className = 'playing-card back'; back.style.left = '0'; back.style.top = top; back.style.pointerEvents = 'none'; board.append(back);
  }
  slot('waste', 0, 1, top, '뽑은 카드');
  if (game.waste.length) makeCard(game.waste.at(-1), { type: 'waste' }, 1, top, 2);
  game.foundations.forEach((pile, index) => {
    slot('foundations', index, index + 3, top, `기초 더미 ${index + 1}`);
    if (pile.length) makeCard(pile.at(-1), { type: 'foundations', index }, index + 3, top, 2);
  });
  game.tableau.forEach((pile, index) => {
    slot('tableau', index, index, lower, `열 ${index + 1}`);
    pile.forEach((card, n) => makeCard(card, { type: 'tableau', index, card: n }, index, `calc(${lower} + var(--step) * ${n})`, n + 2));
  });
  const maxCards = Math.max(...game.tableau.map(pile => pile.length));
  board.style.height = `calc(22px + var(--card-h) * 2 + var(--gap) * 2 + var(--step) * ${Math.max(0, maxCards - 1)} + 35px)`;
  $('#score').textContent = game.score; $('#moves').textContent = game.moves; $('#time').textContent = formatTime(elapsed);
  $('#undo').disabled = !history.length || won; $('#auto').disabled = won || game.stock.length > 0 || game.tableau.some(pile => pile.some(card => !card.faceUp));
  $('#paused').hidden = !paused; $('#pause').textContent = paused ? '계속하기' : '일시 정지';
}
function setPaused(value) { if (won) return; paused = value; lastTick = Date.now(); render(); }
$('#new').onclick = startGame; $('#win-new').onclick = startGame; $('#win-close').onclick = () => winDialog.close();
$('#undo').onclick = undo;
$('#hint').onclick = () => {
  if (paused || won) return;
  hint = findMoves(game)[0] || null; selected = null;
  message.textContent = hint ? '강조된 카드와 위치를 확인하세요.' : game.stock.length || game.waste.length ? '카드 더미를 눌러 보세요.' : '가능한 이동이 없습니다.';
  render();
};
$('#auto').onclick = () => {
  const step = () => {
    if (paused || won) return;
    const next = findMoves(game).find(item => item.target.type === 'foundations');
    if (next && attempt(next.source, next.target)) animation = setTimeout(step, 130);
    else if (!won) message.textContent = '자동으로 옮길 수 있는 카드가 없습니다.';
  };
  step();
};
$('#pause').onclick = () => setPaused(!paused); $('#resume').onclick = () => setPaused(false);
$('#settings').onclick = () => {
  setPaused(true); $('#draw-count').value = String(options.draw); $('#back-color').value = options.back;
  $('#stats').textContent = `플레이 ${stats.played}회 · 승리 ${stats.won}회 · 최고 기록 ${stats.best === null ? '--:--' : formatTime(stats.best)}`;
  settings.showModal();
};
$('#close-settings').onclick = () => settings.close();
settings.onclose = () => { options = { draw: Number($('#draw-count').value), back: $('#back-color').value }; save('options', options); setPaused(false); };
window.addEventListener('keydown', event => {
  if (event.ctrlKey && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
  if (event.key === 'Escape' && !settings.open && !winDialog.open) setPaused(!paused);
});
window.addEventListener('blur', () => { if (!settings.open && !winDialog.open) setPaused(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
setInterval(() => { const now = Date.now(); if (!paused && !won && !document.hidden) { elapsed += Math.floor((now - lastTick) / 1000); if (now - lastTick >= 1000) lastTick = now; $('#time').textContent = formatTime(elapsed); } else lastTick = now; }, 250);
startGame();
