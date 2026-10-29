const $ = selector => document.querySelector(selector);
const canvas = $('#canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const icons = {
  pencil: '<path d="m4 17 11-11 3 3L7 20H4z M14 7l3 3"/>',
  brush: '<path d="m13 5 3-3 5 5-3 3-7 7-4-4z M7 13c-4 0-3 5-5 6 4 2 8 0 9-2"/>',
  eraser: '<path d="m4 15 9-10a2 2 0 0 1 3 0l4 4-9 10H7z M9 19h12 M8 11l6 6"/>',
  line: '<path d="M4 20 20 4"/>', rect: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>', fill: '<path d="m4 12 7-7 8 8-7 7z M7 3l5 5 M20 16c0 2-2 3-2 4a2 2 0 0 0 4 0c0-1-2-2-2-4z"/>',
  picker: '<path d="m14 5 5 5 M5 19l3-1 10-10-3-3L5 15z M14 5l2-2a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3l-2 2"/>',
  text: '<path d="M4 5h16 M12 5v14 M8 19h8"/>', open: '<path d="M3 6h6l2 2h10l-2 11H3z"/>', save: '<path d="M4 3h14l2 2v16H4z M8 3v6h8V3 M8 21v-8h8v8"/>',
  undo: '<path d="M9 7 4 12l5 5 M4 12h10a5 5 0 0 1 5 5"/>', redo: '<path d="m15 7 5 5-5 5 M20 12H10a5 5 0 0 0-5 5"/>',
  clear: '<path d="M4 7h16 M8 7V4h8v3 M7 7l1 13h8l1-13"/>', resize: '<path d="M4 10V4h6 M14 20h6v-6 M4 4l6 6 M20 20l-6-6"/>', download: '<path d="M12 3v12 M8 11l4 4 4-4 M4 18v3h16v-3"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
let tool = 'pencil';
let path = null;
let zoom = 1;
let drawing = null;
let undoStack = [];
let redoStack = [];
let dirty = false;

function readFS() {
  try { const data = JSON.parse(localStorage.getItem('win11web.fs')); return data && data.files ? data : { files: {} }; }
  catch { return { files: {} }; }
}
function title() { document.title = `${dirty ? '*' : ''}${path ? path.split('/').pop() : '제목 없음'} - 그림판`; }
function updateSize() {
  $('#dimensions').textContent = `${canvas.width} × ${canvas.height}px`;
  canvas.style.width = `${canvas.width * zoom}px`; canvas.style.height = `${canvas.height * zoom}px`;
  $('#zoom-label').textContent = `${Math.round(zoom * 100)}%`;
}
function snapshot() { return { width: canvas.width, height: canvas.height, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height) }; }
function restore(state) {
  canvas.width = state.width; canvas.height = state.height; ctx.putImageData(state.pixels, 0, 0); updateSize();
}
function record() { undoStack.push(snapshot()); if (undoStack.length > 20) undoStack.shift(); redoStack = []; }
function changed() { dirty = true; title(); }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); changed(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); changed(); }
function whiteBackground() { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
function dialog(titleText, messageText, build, submit, submitText = '확인') {
  const box = $('#dialog'); if (box.open) box.close();
  $('#dialog-title').textContent = titleText; $('#dialog-message').textContent = messageText;
  const content = $('#dialog-content'); content.replaceChildren(); if (build) build(content);
  const actions = $('#dialog-actions'); actions.replaceChildren();
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn'; cancel.textContent = '취소'; cancel.onclick = () => box.close();
  const ok = document.createElement('button'); ok.className = 'btn primary'; ok.textContent = submitText;
  actions.append(cancel, ok); $('#dialog-form').onsubmit = event => { event.preventDefault(); submit(box); };
  box.showModal(); content.querySelector('input')?.focus();
}
function message(text) { dialog('그림판', text, null, box => box.close()); }
function input(label, value, type = 'text') {
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const field = document.createElement('input'); field.className = 'input'; field.type = type; field.value = value; wrapper.append(field); return [wrapper, field];
}
function save() {
  let field;
  dialog('다른 이름으로 저장', '그림 파일을 PNG 형식으로 저장합니다.', content => { const pair = input('파일 경로', path || '/사진/그림.png'); field = pair[1]; content.append(pair[0]); }, box => {
    let target = field.value.trim(); if (!target) { $('#dialog-message').textContent = '파일 경로를 입력하세요.'; return; }
    if (!target.startsWith('/')) target = `/사진/${target}`;
    if (!target.startsWith('/사진/') || target.slice(4).includes('/') || target.endsWith('/')) { $('#dialog-message').textContent = '/사진/ 폴더 안의 파일 경로를 입력하세요.'; return; }
    if (!target.toLowerCase().endsWith('.png')) target += '.png';
    const data = readFS();
    if (data.files[target]?.type === 'folder') { $('#dialog-message').textContent = '같은 이름의 폴더가 있습니다.'; return; }
    data.files[target] = { type: 'image', content: canvas.toDataURL('image/png'), modified: Date.now() };
    try { localStorage.setItem('win11web.fs', JSON.stringify(data)); path = target; dirty = false; title(); box.close(); }
    catch { $('#dialog-message').textContent = '저장하지 못했습니다. 저장 공간을 확인하세요.'; }
  }, '저장');
}
function load(target) {
  const file = readFS().files[target];
  if (!file || file.type !== 'image') { message('이미지 파일을 찾을 수 없습니다.'); return; }
  const image = new Image();
  image.onload = () => {
    if (image.width > 4096 || image.height > 4096) { message('이미지가 너무 큽니다. 최대 크기는 4096 × 4096입니다.'); return; }
    record(); canvas.width = image.width; canvas.height = image.height; whiteBackground(); ctx.drawImage(image, 0, 0); path = target; dirty = false; title(); updateSize();
  };
  image.onerror = () => message('이미지를 열 수 없습니다.'); image.src = file.content;
}
function openDialog() {
  dialog('열기', '열 이미지 파일을 선택하세요.', content => {
    const files = Object.entries(readFS().files).filter(([, file]) => file.type === 'image').sort(([a], [b]) => a.localeCompare(b, 'ko'));
    if (!files.length) content.textContent = '저장된 이미지가 없습니다.';
    for (const [filename] of files) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn file'; button.textContent = filename;
      button.onclick = () => { $('#dialog').close(); load(filename); }; content.append(button);
    }
  }, box => box.close(), '닫기');
}
function resizeCanvas() {
  let width, height;
  dialog('캔버스 크기 조정', '새 캔버스 크기를 입력하세요. 기존 그림은 왼쪽 위에 유지됩니다.', content => {
    const a = input('너비', canvas.width, 'number'); const b = input('높이', canvas.height, 'number'); width = a[1]; height = b[1];
    for (const field of [width, height]) { field.min = 1; field.max = 4096; field.step = 1; } content.append(a[0], b[0]);
  }, box => {
    const w = Number(width.value), h = Number(height.value);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 4096 || h > 4096) { $('#dialog-message').textContent = '1부터 4096 사이의 정수를 입력하세요.'; return; }
    record(); const old = snapshot(); canvas.width = w; canvas.height = h; whiteBackground(); ctx.putImageData(old.pixels, 0, 0); updateSize(); changed(); box.close();
  }, '확인');
}
function point(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(canvas.width - 1, (event.clientX - rect.left) * canvas.width / rect.width)), y: Math.max(0, Math.min(canvas.height - 1, (event.clientY - rect.top) * canvas.height / rect.height)) };
}
function strokeStyle(color, width) { ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
function drawShape(start, end, color) {
  strokeStyle(color, Number($('#size').value)); ctx.beginPath();
  if (tool === 'line') { ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke(); return; }
  const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y), w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
  if (tool === 'rect') ctx.rect(x, y, w, h); else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  if ($('#shape-mode').value === 'fill') ctx.fill(); else ctx.stroke();
}
function flood(x, y, color) {
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height); const pixels = image.data; const w = image.width, h = image.height;
  const start = (Math.floor(y) * w + Math.floor(x)) * 4; const original = Array.from(pixels.slice(start, start + 4));
  const replacement = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), 255];
  if (original.every((value, i) => value === replacement[i])) return;
  const tolerance = Number($('#tolerance').value); const visited = new Uint8Array(w * h); const stack = [Math.floor(y) * w + Math.floor(x)];
  while (stack.length) {
    const index = stack.pop(); if (visited[index]) continue; visited[index] = 1; const offset = index * 4;
    if (original.some((value, i) => Math.abs(value - pixels[offset + i]) > tolerance)) continue;
    for (let i = 0; i < 4; i++) pixels[offset + i] = replacement[i];
    const px = index % w, py = Math.floor(index / w);
    if (px > 0) stack.push(index - 1); if (px < w - 1) stack.push(index + 1); if (py > 0) stack.push(index - w); if (py < h - 1) stack.push(index + w);
  }
  ctx.putImageData(image, 0, 0);
}
function addText(position, color) {
  let field;
  dialog('텍스트 입력', '캔버스에 넣을 텍스트를 입력하세요.', content => { const pair = input('텍스트', ''); field = pair[1]; content.append(pair[0]); }, box => {
    if (field.value) { record(); ctx.fillStyle = color; ctx.font = `${Math.max(12, Number($('#size').value) * 4)}px sans-serif`; ctx.textBaseline = 'top'; ctx.fillText(field.value, position.x, position.y); changed(); } box.close();
  }, '확인');
}
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 && event.button !== 2) return;
  event.preventDefault(); const p = point(event); const color = event.button === 2 ? $('#secondary').value : $('#primary').value;
  if (tool === 'picker') { const pixel = ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data; const value = '#' + [...pixel.slice(0, 3)].map(n => n.toString(16).padStart(2, '0')).join(''); (event.button === 2 ? $('#secondary') : $('#primary')).value = value; return; }
  if (tool === 'text') { addText(p, color); return; }
  record();
  if (tool === 'fill') { flood(p.x, p.y, color); changed(); return; }
  drawing = { start: p, last: p, color: tool === 'eraser' ? '#ffffff' : color, base: snapshot(), pointer: event.pointerId };
  canvas.setPointerCapture(event.pointerId);
  if (['pencil', 'brush', 'eraser'].includes(tool)) { strokeStyle(drawing.color, tool === 'pencil' ? 1 : Number($('#size').value)); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.01, p.y + 0.01); ctx.stroke(); }
});
canvas.addEventListener('pointermove', event => {
  const p = point(event); $('#position').textContent = `위치: ${Math.floor(p.x)}, ${Math.floor(p.y)}`;
  if (!drawing || event.pointerId !== drawing.pointer) return;
  if (['pencil', 'brush', 'eraser'].includes(tool)) {
    strokeStyle(drawing.color, tool === 'pencil' ? 1 : Number($('#size').value)); ctx.beginPath(); ctx.moveTo(drawing.last.x, drawing.last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); drawing.last = p;
  } else { ctx.putImageData(drawing.base.pixels, 0, 0); drawShape(drawing.start, p, drawing.color); }
});
function endDraw(event) { if (drawing && event.pointerId === drawing.pointer) { drawing = null; changed(); } }
canvas.addEventListener('pointerup', endDraw); canvas.addEventListener('pointercancel', endDraw);
canvas.addEventListener('pointerleave', () => { if (!drawing) $('#position').textContent = '위치: —'; });
const tools = [['pencil','연필'], ['brush','브러시'], ['eraser','지우개'], ['line','선'], ['rect','사각형'], ['ellipse','타원'], ['fill','채우기'], ['picker','색 선택'], ['text','텍스트']];
for (const [id, label] of tools) {
  const button = document.createElement('button'); button.type = 'button'; button.className = `tool${id === tool ? ' active' : ''}`; button.title = label; button.setAttribute('aria-label', label); button.setAttribute('aria-pressed', String(id === tool)); button.innerHTML = icon(id);
  button.onclick = () => { tool = id; document.querySelectorAll('.tool').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); }); }; $('#tools').append(button);
}
const commands = [['open','열기',openDialog], ['save','저장',save], ['undo','실행 취소',undo], ['redo','다시 실행',redo], ['clear','지우기',() => dialog('캔버스 지우기', '캔버스를 모두 지우시겠습니까?', null, box => { record(); whiteBackground(); changed(); box.close(); }, '지우기')], ['resize','크기 조정',resizeCanvas], ['download','PNG 다운로드',() => { const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = path ? path.split('/').pop() : '그림.png'; link.click(); }]];
for (const [id, label, action] of commands) { const button = document.createElement('button'); button.className = 'btn'; button.title = label; button.setAttribute('aria-label', label); button.innerHTML = `${icon(id)}<span>${label}</span>`; button.onclick = action; $('#filebar').append(button); }
for (const color of ['#000000','#7f7f7f','#880015','#ed1c24','#ff7f27','#fff200','#22b14c','#00a2e8','#3f48cc','#a349a4','#ffffff','#c3c3c3','#b97a57','#ffaec9','#ffc90e','#efe4b0','#b5e61d','#99d9ea','#7092be','#c8bfe7']) {
  const button = document.createElement('button'); button.className = 'swatch'; button.style.backgroundColor = color; button.title = color; button.setAttribute('aria-label', `색상 ${color}`);
  button.onclick = () => { $('#primary').value = color; }; button.oncontextmenu = event => { event.preventDefault(); $('#secondary').value = color; }; $('#palette').append(button);
}
$('#size').oninput = event => { $('#size-value').textContent = `${event.target.value}px`; };
$('#tolerance').oninput = event => { $('#tolerance-value').textContent = event.target.value; };
$('#zoom-in').onclick = () => { zoom = Math.min(4, zoom + 0.25); updateSize(); };
$('#zoom-out').onclick = () => { zoom = Math.max(0.25, zoom - 0.25); updateSize(); };
window.addEventListener('keydown', event => {
  if ($('#dialog').open || !event.ctrlKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (['z','y','s','o'].includes(key)) { event.preventDefault(); if (key === 'z') event.shiftKey ? redo() : undo(); if (key === 'y') redo(); if (key === 's') save(); if (key === 'o') openDialog(); }
});
whiteBackground(); updateSize(); title();
const initialPath = new URLSearchParams(location.search).get('file'); if (initialPath) load(initialPath);
