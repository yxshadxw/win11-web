const STORAGE = 'win11web.memory.';
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


const emojis = ['🍎', '🍊', '🍋', '🍇', '🍓', '🍒', '🍉', '🍍', '🥝', '🍑', '🍌', '🥑', '🌸', '⭐', '🌈', '🐱', '🐶', '🦋'];
let cards = [], selected = [], moves = 0, matched = 0, elapsed = 0, lastTime = 0, lock = 0, difficulty = '4x4';
let best = read('best', {});
function formatTime(seconds) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function hud() {
  const record = best[difficulty];
  $('#hud').innerHTML = `<div class="card stat"><small>횟수</small><strong>${moves}</strong></div><div class="card stat"><small>시간</small><strong>${formatTime(elapsed)}</strong></div><div class="card stat"><small>최고 기록</small><strong>${record ? record.moves + '회 · ' + formatTime(record.time) : '없음'}</strong></div>`;
  document.title = `기억력 게임 - ${moves}회`;
}
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; }
  return array;
}
function startGame() {
  difficulty = $('#difficulty').value;
  const [columns, rows] = difficulty.split('x').map(Number);
  const faces = shuffle([...emojis]).slice(0, columns * rows / 2);
  cards = shuffle([...faces, ...faces]).map((face, index) => ({ face, index, matched: false }));
  selected = []; moves = 0; matched = 0; elapsed = 0; lock = 0;
  const board = $('#board'); board.style.setProperty('--cols', columns); board.replaceChildren();
  for (const card of cards) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'tile'; button.setAttribute('aria-label', '뒤집힌 카드');
    button.innerHTML = `<span class="tile-inner"><span class="face back" aria-hidden="true">?</span><span class="face front" aria-hidden="true">${card.face}</span></span>`;
    button.onclick = () => flip(card, button); card.element = button; board.append(button);
  }
  resume(); hud(); sound();
}
function flip(card, button) {
  if (state !== 'playing' || lock > 0 || card.matched || selected.some(item => item.card === card)) return;
  selected.push({ card, button }); button.classList.add('flipped'); button.setAttribute('aria-label', card.face); sound(520, .07);
  if (selected.length !== 2) return;
  moves++; hud();
  if (selected[0].card.face === selected[1].card.face) {
    for (const item of selected) { item.card.matched = true; item.button.classList.add('matched'); item.button.setAttribute('aria-label', `${item.card.face} · 짝 맞춤`); }
    selected = []; matched += 2; sound(760, .14);
    if (matched === cards.length) win();
  } else { lock = .8; shake(); sound(220, .12); }
}
function win() {
  state = 'over';
  const pairs = cards.length / 2;
  const stars = moves <= pairs * 1.3 ? 3 : moves <= pairs * 2 ? 2 : 1;
  const old = best[difficulty];
  if (!old || moves < old.moves || (moves === old.moves && elapsed < old.time)) { best[difficulty] = { moves, time: Math.floor(elapsed) }; save('best', best); }
  hud(); sound(900, .35); stage.classList.add('celebrate');
  showOverlay('모두 맞췄습니다!', `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)} · ${moves}회 · ${formatTime(elapsed)}`, '다시 시작', true);
}
function frame(time) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, .1) : 0; lastTime = time;
  if (state === 'playing') {
    elapsed += dt;
    if (lock > 0) { lock -= dt; if (lock <= 0) { for (const item of selected) { item.button.classList.remove('flipped'); item.button.setAttribute('aria-label', '뒤집힌 카드'); } selected = []; } }
    hud();
  }
  requestAnimationFrame(frame);
}
$('#help').textContent = '카드를 뒤집어 같은 그림을 찾으세요 · P / Esc 일시 정지';
showOverlay('기억력 게임', '같은 그림의 카드 짝을 찾으세요. 적은 횟수로 맞힐수록 더 많은 별을 얻습니다.', '게임 시작', true);
hud(); requestAnimationFrame(frame);
