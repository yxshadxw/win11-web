const $ = selector => document.querySelector(selector);
const gallery = $('#gallery');
const viewer = $('#viewer');
const stage = $('#stage');
const image = $('#image');
let paths = [];
let current = '';
let scale = 1;
let angle = 0;
let x = 0;
let y = 0;
const pointers = new Map();
let gesture = null;

function readFS() {
  try { const data = JSON.parse(localStorage.getItem('win11web.fs')); return data && data.files && typeof data.files === 'object' ? data : { files: {} }; }
  catch { return { files: {} }; }
}
function writeFS(data) { localStorage.setItem('win11web.fs', JSON.stringify(data)); }
function error(message) { $('#error-message').textContent = message; if (!$('#error').open) $('#error').showModal(); }
function seed() {
  const data = readFS();
  try {
    if (localStorage.getItem('win11web.photos.seeded')) return;
    if (Object.keys(data.files).some(path => path.startsWith('/사진/'))) { localStorage.setItem('win11web.photos.seeded', '1'); return; }
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const context = canvas.getContext('2d');
    const samples = [
      ['푸른 물결.png', '#1e5b9e', '#83d8ef', '#d7f7ff'],
      ['저녁 빛.png', '#a1495e', '#f6c77b', '#fff0cf'],
      ['초록 정원.png', '#1d685e', '#b2d797', '#edf6cf']
    ];
    for (const [name, start, end, shape] of samples) {
      const gradient = context.createLinearGradient(0, 0, 640, 480); gradient.addColorStop(0, start); gradient.addColorStop(1, end);
      context.fillStyle = gradient; context.fillRect(0, 0, 640, 480);
      context.globalAlpha = .65; context.fillStyle = shape; context.beginPath(); context.arc(470, 130, 80, 0, Math.PI * 2); context.fill();
      context.globalAlpha = .3; context.beginPath(); context.moveTo(0, 390); context.bezierCurveTo(180, 180, 320, 520, 640, 260); context.lineTo(640, 480); context.lineTo(0, 480); context.fill(); context.globalAlpha = 1;
      let path = `/사진/${name}`;
      if (!data.files[path]) data.files[path] = { type: 'image', content: canvas.toDataURL('image/png'), modified: Date.now() };
    }
    writeFS(data); localStorage.setItem('win11web.photos.seeded', '1');
  } catch { error('샘플 사진을 저장할 수 없습니다. 저장 공간을 확인하세요.'); }
}
function refresh() {
  const files = readFS().files;
  paths = Object.keys(files).filter(path => files[path]?.type === 'image' && typeof files[path].content === 'string').sort((a, b) => a.localeCompare(b, 'ko'));
  const groups = $('#groups'); groups.replaceChildren(); $('#empty').hidden = paths.length > 0;
  const folders = new Map();
  for (const path of paths) { const folder = path.slice(0, path.lastIndexOf('/')) || '/'; if (!folders.has(folder)) folders.set(folder, []); folders.get(folder).push(path); }
  for (const [folder, items] of folders) {
    const section = document.createElement('section'); section.className = 'group';
    const title = document.createElement('h2'); title.textContent = folder; section.append(title);
    const grid = document.createElement('div'); grid.className = 'grid';
    for (const path of items) {
      const button = document.createElement('button'); button.className = 'photo'; button.type = 'button';
      const thumb = document.createElement('img'); thumb.src = files[path].content; thumb.alt = ''; thumb.loading = 'lazy';
      const name = document.createElement('span'); name.textContent = path.split('/').pop(); button.append(thumb, name); button.onclick = () => open(path); grid.append(button);
    }
    section.append(grid); groups.append(section);
  }
}
function transform() { image.style.transform = `translate(${x}px, ${y}px) rotate(${angle}deg) scale(${scale})`; $('#zoom-label').textContent = `${Math.round(scale * 100)}%`; }
function fit() { scale = 1; x = 0; y = 0; transform(); }
function open(path) {
  const file = readFS().files[path];
  if (!file || file.type !== 'image') { error('사진을 찾을 수 없습니다.'); return; }
  current = path; angle = 0; fit(); image.src = file.content; image.alt = path.split('/').pop(); $('#filename').textContent = image.alt;
  $('#edit').href = `/apps/paint/?file=${encodeURIComponent(path)}`;
  gallery.hidden = true; viewer.hidden = false; document.title = `${image.alt} - 사진`; stage.focus();
}
function back() { viewer.hidden = true; gallery.hidden = false; current = ''; document.title = '사진'; refresh(); }
function move(delta) { if (!paths.length) return; const index = paths.indexOf(current); open(paths[(index + delta + paths.length) % paths.length]); }
function zoom(factor) { scale = Math.max(.1, Math.min(8, scale * factor)); transform(); }
$('#back').onclick = back; $('#zoom-in').onclick = () => zoom(1.25); $('#zoom-out').onclick = () => zoom(1 / 1.25); $('#fit').onclick = fit;
$('#rotate').onclick = () => { angle = (angle + 90) % 360; transform(); };
$('.previous').onclick = () => move(-1); $('.next').onclick = () => move(1);
$('#delete').onclick = () => { $('#confirm-name').textContent = current; $('#confirm').showModal(); };
$('#cancel').onclick = () => $('#confirm').close(); $('#error-close').onclick = () => $('#error').close();
$('#confirm-delete').onclick = () => { const data = readFS(); delete data.files[current]; try { writeFS(data); $('#confirm').close(); back(); } catch { $('#confirm').close(); error('사진을 삭제할 수 없습니다.'); } };
stage.addEventListener('wheel', event => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
function distance() { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }
stage.addEventListener('pointerdown', event => { if (event.target.closest('button')) return; stage.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); gesture = pointers.size === 2 ? { distance: distance(), scale } : { x: event.clientX, y: event.clientY, originX: x, originY: y }; });
stage.addEventListener('pointermove', event => { if (!pointers.has(event.pointerId)) return; pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointers.size === 2 && gesture?.distance) { scale = Math.max(.1, Math.min(8, gesture.scale * distance() / gesture.distance)); transform(); } else if (pointers.size === 1 && gesture && !gesture.distance) { x = gesture.originX + event.clientX - gesture.x; y = gesture.originY + event.clientY - gesture.y; transform(); } });
function endPointer(event) { pointers.delete(event.pointerId); const remaining = [...pointers.values()][0]; gesture = remaining ? { x: remaining.x, y: remaining.y, originX: x, originY: y } : null; }
stage.addEventListener('pointerup', endPointer); stage.addEventListener('pointercancel', endPointer);
window.addEventListener('keydown', event => { if (viewer.hidden || $('#confirm').open || $('#error').open) return; if (event.key === 'ArrowLeft') move(-1); else if (event.key === 'ArrowRight') move(1); else if (event.key === 'Escape') back(); });
window.addEventListener('storage', event => { if (event.key === 'win11web.fs') { refresh(); if (current && !paths.includes(current)) back(); } });
seed(); refresh();
const initial = new URLSearchParams(location.search).get('file'); if (initial) open(initial);
