const $ = (id) => document.getElementById(id);
const koreanWords = ['하늘', '구름', '바람', '별빛', '나무', '바다', '여행', '노을', '기차', '소리', '마음', '햇살', '우산', '꽃잎', '약속', '여름', '고래', '달빛', '산책', '파도', '연필', '꿈나라', '도서관', '무지개', '반딧불', '자전거', '눈송이', '초록빛', '물방울', '종이배'];
const englishWords = ['cloud', 'breeze', 'star', 'forest', 'ocean', 'journey', 'sunset', 'train', 'melody', 'sunshine', 'umbrella', 'petal', 'summer', 'whale', 'moonlight', 'wave', 'pencil', 'rainbow', 'bicycle', 'snowflake'];
const koreanSentences = [
  '작은 창문 너머로 아침 햇살이 번집니다.', '바람이 지나간 자리마다 풀잎이 흔들립니다.', '오늘의 산책은 골목 끝 작은 공원에서 시작합니다.', '따뜻한 차 한 잔이 느린 오후를 채웁니다.', '하늘을 올려다보니 구름이 천천히 흘러갑니다.',
  '빗방울이 지붕 위에서 가벼운 노래를 만듭니다.', '새로운 길을 걷는 일은 언제나 작은 모험입니다.', '책장을 넘길 때마다 다른 풍경이 펼쳐집니다.', '달빛 아래 고요한 강물이 은빛으로 빛납니다.', '서로의 이야기를 듣는 시간은 소중합니다.',
  '먼 산 위에 걸린 노을이 붉게 물듭니다.', '작은 씨앗 하나가 커다란 나무로 자랍니다.', '오늘은 어제보다 조금 더 멀리 걸었습니다.', '창가에 놓인 화분에 물을 주었습니다.', '낯선 거리에서 익숙한 노래가 들립니다.',
  '천천히 숨을 고르고 다시 한 걸음 내딛습니다.', '바닷가 모래 위에 발자국이 나란히 남습니다.', '친구와 나눈 웃음이 오래도록 기억에 남습니다.', '주머니 속 조약돌은 여행의 작은 기념품입니다.', '아침 공기에는 새로운 하루의 냄새가 납니다.',
  '따스한 불빛이 켜진 집으로 돌아갑니다.', '기차 창밖으로 들판과 마을이 지나갑니다.', '밤하늘의 별을 세다가 잠이 들었습니다.', '종이 위에 떠오른 생각을 차분히 적습니다.', '비가 그친 뒤 거리에는 맑은 향기가 납니다.',
  '조용한 도서관에서 마음에 드는 책을 찾았습니다.', '따뜻한 말 한마디가 하루를 환하게 만듭니다.', '나뭇가지 사이로 작은 새가 날아갑니다.', '오늘의 실수도 내일을 위한 연습이 됩니다.', '햇빛에 반짝이는 물결을 한참 바라봅니다.',
  '길가의 꽃들이 저마다 다른 색으로 피어납니다.', '좋아하는 음악과 함께 방을 정리합니다.', '구름 뒤에 숨었던 달이 다시 모습을 드러냅니다.', '가끔은 아무 계획 없이 쉬어 가도 좋습니다.', '오래된 지도에서 가 보고 싶은 곳을 찾습니다.',
  '차가운 겨울 아침에도 새들은 노래합니다.', '서두르지 않아도 각자의 속도로 도착합니다.', '작은 친절은 멀리까지 이어질 수 있습니다.', '저녁 식탁에는 오늘의 이야기가 모입니다.', '새로운 계절을 맞아 창문을 활짝 엽니다.'
];
const englishSentences = ['A quiet morning begins with a warm cup of tea.', 'The little stars shimmer above the sleeping town.', 'Every new path holds a small surprise.', 'The wind carries leaves across the open field.', 'A kind word can brighten an ordinary day.', 'We watched the clouds drift over the distant hills.', 'The train rolled slowly through the green valley.', 'Take your time and enjoy the journey.', 'Rain makes a gentle rhythm on the window.', 'A fresh idea starts with a curious question.'];
let mode = 'rain', language = 'ko', state = 'ready', composing = false, muted = false, audio;
let words = [], target = '', lives = 3, combo = 0, correct = 0, attempts = 0, elapsed = 0, spawn = 0, last = 0, sentenceIndex = 0, previousValue = '';
const answer = $('answer'), arena = $('arena');
function sound(freq) {
  if (muted) return;
  try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = freq; g.gain.setValueAtTime(.025, audio.currentTime); g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .1); o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + .1); } catch { /* Audio is optional. */ }
}
function recordKey() { return `win11web.typing.${mode}.${language}.best`; }
function best() { try { return Number(localStorage.getItem(recordKey())) || 0; } catch { return 0; } }
function speed() { return elapsed > 0 ? Math.round(correct / elapsed * 60) : 0; }
function accuracy() { return attempts ? Math.round(correct / attempts * 100) : 100; }
function stats() { $('speed').textContent = `타수 ${speed()}`; $('accuracy').textContent = `정확도 ${accuracy()}%`; $('extra').textContent = mode === 'rain' ? `생명 ${'♥'.repeat(lives)} · 콤보 ${combo} · 단계 ${1 + Math.floor(elapsed / 20)}` : `문장 ${sentenceIndex + 1} / 5`; }
function showNotice(title, message, button) { $('notice').hidden = false; $('notice').querySelector('strong').textContent = title; $('notice').querySelector('p').textContent = message; $('start').textContent = button; }
function clearWords() { words.forEach((word) => word.element.remove()); words = []; }
function selectMode(next) { mode = next; state = 'ready'; clearWords(); answer.value = ''; answer.disabled = true; $('sentence').hidden = mode !== 'sentence'; $('mode-label').textContent = mode === 'rain' ? '낱말 비' : '문장 연습'; $('rain-mode').classList.toggle('primary', mode === 'rain'); $('sentence-mode').classList.toggle('primary', mode === 'sentence'); $('hint').textContent = mode === 'rain' ? '떨어지는 낱말을 입력하고 Enter를 누르세요.' : '보이는 문장을 끝까지 입력하세요.'; showNotice('준비되셨나요?', `최고 기록 ${best()}타`, '시작하기'); }
function nextSentence() { const list = language === 'ko' ? koreanSentences : englishSentences; target = list[(Math.floor(Math.random() * list.length))]; answer.value = ''; previousValue = ''; renderSentence(); }
function renderSentence() {
  const value = answer.value, container = $('sentence'); container.replaceChildren();
  [...target].forEach((character, index) => { const span = document.createElement('span'); span.textContent = character; if (index < value.length) span.className = value[index] === character ? 'correct' : 'wrong'; else if (index === value.length) span.className = 'current'; container.append(span); });
}
function start() { clearWords(); state = 'playing'; lives = 3; combo = 0; correct = 0; attempts = 0; elapsed = 0; spawn = 0; sentenceIndex = 0; last = 0; answer.value = ''; answer.disabled = false; $('notice').hidden = true; if (mode === 'sentence') nextSentence(); stats(); answer.focus(); }
function finish() { state = 'result'; answer.disabled = true; const result = speed(); const old = best(); if (result > old) { try { localStorage.setItem(recordKey(), String(result)); } catch { /* Storage can be unavailable. */ } } showNotice('연습 결과', `타수 ${result} · 정확도 ${accuracy()}%\n최고 기록 ${Math.max(result, old)}타`, '다시 시작'); }
function pause() { if (state !== 'playing') return; state = 'paused'; answer.disabled = true; showNotice('일시 정지', '준비되면 계속 연습하세요.', '계속하기'); }
function addWord() { const list = language === 'ko' ? koreanWords : englishWords; const text = list[Math.floor(Math.random() * list.length)]; const element = document.createElement('span'); element.className = 'word'; element.textContent = text; arena.append(element); const max = Math.max(0, arena.clientWidth - element.offsetWidth); const word = { text, element, x: Math.random() * max, y: -30 }; words.push(word); }
function update(dt) { elapsed += dt; if (mode === 'rain') { spawn -= dt; if (spawn <= 0) { addWord(); spawn = Math.max(.55, 2 - elapsed / 100); } const fall = 26 + Math.floor(elapsed / 20) * 8; words.forEach((word) => { word.y += fall * dt; word.element.style.transform = `translate(${word.x}px, ${word.y}px)`; }); for (const word of words.filter((w) => w.y > arena.clientHeight - 32)) { word.element.remove(); lives--; combo = 0; sound(140); } words = words.filter((word) => word.y <= arena.clientHeight - 32); if (lives <= 0) { lives = 0; finish(); } } stats(); }
function frame(time) { const dt = last ? Math.min(.05, (time - last) / 1000) : 0; last = time; if (state === 'playing') update(dt); requestAnimationFrame(frame); }
function checkSentence() {
  if (state !== 'playing' || composing || mode !== 'sentence') return;
  const value = answer.value;
  let common = 0;
  while (common < value.length && common < previousValue.length && value[common] === previousValue[common]) common++;
  for (let i = common; i < value.length; i++) { attempts++; if (value[i] === target[i]) correct++; }
  previousValue = value;
  renderSentence(); stats();
  if (value === target) { sentenceIndex++; sound(620); if (sentenceIndex >= 5) finish(); else nextSentence(); }
}
answer.addEventListener('compositionstart', () => { composing = true; });
answer.addEventListener('compositionend', () => { composing = false; checkSentence(); });
answer.addEventListener('input', () => { if (composing) { if (mode === 'sentence') renderSentence(); return; } checkSentence(); });
answer.addEventListener('keydown', (event) => { if (event.key !== 'Enter' || composing || event.isComposing || state !== 'playing' || mode !== 'rain') return; event.preventDefault(); const value = answer.value.trim(); if (!value) return; const match = words.find((word) => word.text === value); attempts += [...value].length; if (match) { correct += [...value].length; combo++; match.element.remove(); words = words.filter((word) => word !== match); sound(600); } else { combo = 0; sound(160); } answer.value = ''; stats(); });
$('start').onclick = () => { if (state === 'paused') { state = 'playing'; $('notice').hidden = true; answer.disabled = false; last = 0; answer.focus(); } else start(); };
$('rain-mode').onclick = () => selectMode('rain'); $('sentence-mode').onclick = () => selectMode('sentence'); $('restart').onclick = start; $('pause').onclick = pause;
$('language').onclick = () => { language = language === 'ko' ? 'en' : 'ko'; $('language').textContent = language === 'ko' ? '한국어' : 'English'; selectMode(mode); };
$('sound').onclick = () => { muted = !muted; $('sound').textContent = muted ? '소리 꺼짐' : '소리 켜짐'; };
window.addEventListener('blur', pause); document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
selectMode('rain'); stats(); requestAnimationFrame(frame);
