const $ = selector => document.querySelector(selector);
const icons = {
  folder: '<path d="M3 5h6l2 2h10v11a2 2 0 0 1-2 2H3z"/>',
  text: '<path d="M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 18 5-5 3 3 3-4 5 6"/>',
  add: '<path d="M12 4v16 M4 12h16"/>', cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8 8 12 12 M8 16 20 4"/>',
  copy: '<rect x="8" y="7" width="12" height="14" rx="2"/><path d="M16 7V4H4v14h4"/>', paste: '<rect x="6" y="5" width="13" height="16" rx="2"/><path d="M9 5V3h7v2 M9 11h7 M9 15h7"/>',
  rename: '<path d="M4 20h16 M5 16l10-10 3 3L8 19H5z"/>', delete: '<path d="M4 7h16 M9 7V4h6v3 M7 7l1 13h8l1-13 M10 11v6 M14 11v6"/>', view: '<path d="M4 5h16 M4 12h16 M4 19h16"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.folder}</svg>`;
const defaults = ['/바탕 화면', '/문서', '/사진'];
let current = '/';
let history = ['/'];
let historyIndex = 0;
let selected = new Set();
let anchor = null;
let clipboard = null;
let view = 'details';
let sortKey = 'name';
let ascending = true;
let entries = [];

function readFS() {
  try {
    const data = JSON.parse(localStorage.getItem('win11web.fs'));
    return data && data.files && typeof data.files === 'object' ? data : { files: {} };
  } catch { return { files: {} }; }
}
function writeFS(data) {
  try { localStorage.setItem('win11web.fs', JSON.stringify(data)); return true; }
  catch { message('파일 시스템을 저장할 수 없습니다.'); return false; }
}
function seed() {
  const data = readFS();
  let changed = false;
  for (const path of defaults) {
    if (!data.files[path]) { data.files[path] = { type: 'folder', content: '', modified: Date.now() }; changed = true; }
  }
  try {
    if (!localStorage.getItem('win11web.explorer.seeded')) {
      const path = '/문서/환영합니다.txt';
      if (!data.files[path]) { data.files[path] = { type: 'text', content: 'Windows 11 웹 데스크톱에 오신 것을 환영합니다!', modified: Date.now() }; changed = true; }
      if (!changed || writeFS(data)) localStorage.setItem('win11web.explorer.seeded', '1');
      return;
    }
  } catch { /* Storage is unavailable. */ }
  if (changed) writeFS(data);
}
function basename(path) { return path.split('/').pop(); }
function parent(path) { return path.slice(0, path.lastIndexOf('/')) || '/'; }
function join(dir, name) { return `${dir === '/' ? '' : dir}/${name}`; }
function validName(name) { return name && name !== '.' && name !== '..' && !/[\\/]/.test(name); }
function navigate(path, record = true) {
  current = path; selected.clear(); anchor = null; $('#search').value = '';
  if (record) { history = history.slice(0, historyIndex + 1); history.push(path); historyIndex++; }
  render();
}
function displayType(file) { return file.type === 'folder' ? '파일 폴더' : file.type === 'image' ? 'PNG 이미지' : '텍스트 문서'; }
function fileSize(file) {
  if (file.type === 'folder') return '';
  const size = file.type === 'image' ? Math.max(0, Math.floor((file.content.split(',')[1] || '').length * 3 / 4)) : new TextEncoder().encode(file.content || '').length;
  return `${Math.max(1, Math.ceil(size / 1024))} KB`;
}
function render() {
  const files = readFS().files;
  const query = $('#search').value.trim().toLocaleLowerCase();
  entries = Object.entries(files).filter(([path]) => parent(path) === current && path !== current && basename(path).toLocaleLowerCase().includes(query));
  entries.sort((a, b) => {
    if ((a[1].type === 'folder') !== (b[1].type === 'folder')) return a[1].type === 'folder' ? -1 : 1;
    const values = { name: [basename(a[0]), basename(b[0])], modified: [a[1].modified || 0, b[1].modified || 0], type: [displayType(a[1]), displayType(b[1])], size: [(a[1].content || '').length, (b[1].content || '').length] };
    const [x, y] = values[sortKey];
    return (typeof x === 'number' ? x - y : x.localeCompare(y, 'ko', { numeric: true })) * (ascending ? 1 : -1);
  });
  const crumb = $('#breadcrumbs'); crumb.replaceChildren();
  const parts = current.split('/').filter(Boolean);
  let path = '';
  for (const [index, name] of ['홈', ...parts].entries()) {
    if (index) path += `/${name}`;
    const target = path || '/';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = name; button.onclick = () => navigate(target);
    if (crumb.childElementCount) crumb.append(document.createTextNode('›'));
    crumb.append(button);
  }
  document.title = `${current === '/' ? '홈' : basename(current)} - 파일 탐색기`;
  $('#back').disabled = historyIndex === 0; $('#forward').disabled = historyIndex === history.length - 1; $('#up').disabled = current === '/';
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.path === current));
  const list = $('#list'); list.replaceChildren(); list.className = view === 'icons' ? 'grid' : '';
  if (view === 'details') {
    const header = document.createElement('div'); header.className = 'columns';
    for (const [key, label] of [['name', '이름'], ['modified', '수정한 날짜'], ['type', '유형'], ['size', '크기']]) {
      const button = document.createElement('button'); button.textContent = label + (sortKey === key ? (ascending ? ' ↑' : ' ↓') : '');
      button.onclick = () => { ascending = sortKey === key ? !ascending : true; sortKey = key; render(); }; header.append(button);
    }
    list.append(header);
  }
  for (const [path, file] of entries) {
    const item = document.createElement('div'); item.className = `${view === 'details' ? 'row' : 'tile'}${selected.has(path) ? ' selected' : ''}`;
    item.tabIndex = 0; item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(selected.has(path)));
    const graphic = document.createElement('span'); graphic.className = `file-icon ${file.type}`; graphic.innerHTML = icon(file.type);
    const name = document.createElement('span'); name.className = 'name'; name.append(graphic, document.createTextNode(basename(path)));
    item.append(name);
    if (view === 'details') {
      for (const value of [file.modified ? new Date(file.modified).toLocaleString('ko-KR') : '', displayType(file), fileSize(file)]) {
        const cell = document.createElement('span'); cell.textContent = value; item.append(cell);
      }
    }
    item.onclick = event => select(path, event);
    item.ondblclick = () => open(path);
    item.oncontextmenu = event => { event.preventDefault(); if (!selected.has(path)) { selected = new Set([path]); anchor = path; render(); } showMenu(event.clientX, event.clientY, contextActions()); };
    list.append(item);
  }
  if (!entries.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '이 폴더는 비어 있습니다.'; list.append(empty); }
  $('#status').textContent = `항목 ${entries.length}개${selected.size ? ` · ${selected.size}개 선택됨` : ''}`;
}
function select(path, event) {
  if (event.shiftKey && anchor) {
    const paths = entries.map(entry => entry[0]); const a = paths.indexOf(anchor); const b = paths.indexOf(path);
    if (!event.ctrlKey) selected.clear();
    if (a >= 0 && b >= 0) paths.slice(Math.min(a,b), Math.max(a,b) + 1).forEach(item => selected.add(item));
  } else if (event.ctrlKey || event.metaKey) { selected.has(path) ? selected.delete(path) : selected.add(path); anchor = path; }
  else { selected = new Set([path]); anchor = path; }
  render();
}
function open(path) {
  const file = readFS().files[path]; if (!file) return;
  if (file.type === 'folder') navigate(path);
  else if (file.type === 'text' || file.type === 'image') location.href = `/apps/${file.type === 'text' ? 'notepad' : 'paint'}/?file=${encodeURIComponent(path)}`;
}
function dialog(title, text, initial, callback, confirmLabel = '확인') {
  const box = $('#dialog'); if (box.open) box.close();
  $('#dialog-title').textContent = title; $('#dialog-message').textContent = text;
  const input = $('#dialog-input'); input.hidden = initial === null; input.value = initial || '';
  const actions = $('#dialog-actions'); actions.replaceChildren();
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn'; cancel.textContent = '취소'; cancel.onclick = () => box.close();
  const ok = document.createElement('button'); ok.className = 'btn primary'; ok.textContent = confirmLabel;
  actions.append(cancel, ok); $('#dialog-form').onsubmit = event => { event.preventDefault(); callback(input.value, box); };
  box.showModal(); if (!input.hidden) { input.focus(); input.select(); } else ok.focus();
}
function message(text) { dialog('파일 탐색기', text, null, (_, box) => box.close()); }
function create(type) {
  const suggested = type === 'folder' ? '새 폴더' : '새 텍스트 문서.txt';
  dialog('새로 만들기', '이름을 입력하세요.', suggested, (value, box) => {
    const name = value.trim(); const data = readFS(); const target = join(current, name);
    if (!validName(name) || data.files[target]) { $('#dialog-message').textContent = '유효하고 중복되지 않은 이름을 입력하세요.'; return; }
    data.files[target] = { type, content: '', modified: Date.now() };
    if (writeFS(data)) { box.close(); selected = new Set([target]); render(); }
  }, '만들기');
}
function rename() {
  if (selected.size !== 1) return;
  const source = [...selected][0];
  dialog('이름 바꾸기', '새 이름을 입력하세요.', basename(source), (value, box) => {
    const name = value.trim(); const target = join(parent(source), name); const data = readFS();
    if (!validName(name) || (target !== source && data.files[target])) { $('#dialog-message').textContent = '유효하고 중복되지 않은 이름을 입력하세요.'; return; }
    if (target !== source) {
      const paths = Object.keys(data.files).filter(path => path === source || path.startsWith(source + '/'));
      for (const path of paths) { data.files[target + path.slice(source.length)] = data.files[path]; delete data.files[path]; }
      data.files[target].modified = Date.now();
    }
    if (writeFS(data)) { box.close(); selected = new Set([target]); render(); }
  }, '이름 바꾸기');
}
function remove() {
  if (!selected.size) return;
  dialog('삭제', `선택한 ${selected.size}개 항목을 모두 삭제하시겠습니까?`, null, (_, box) => {
    const data = readFS(); for (const path of Object.keys(data.files)) if ([...selected].some(item => path === item || path.startsWith(item + '/'))) delete data.files[path];
    if (writeFS(data)) { box.close(); selected.clear(); render(); }
  }, '삭제');
}
function copy(cut) { if (selected.size) clipboard = { paths: [...selected], cut }; }
function paste() {
  if (!clipboard) return;
  const data = readFS(); const sources = clipboard.paths.filter(path => data.files[path] && !clipboard.paths.some(other => other !== path && path.startsWith(other + '/')));
  for (const source of sources) {
    if (current === source || current.startsWith(source + '/')) { message('폴더를 그 안에 붙여 넣을 수 없습니다.'); return; }
    let target = join(current, basename(source));
    if (clipboard.cut && target === source) continue;
    if (data.files[target]) {
      const name = basename(source); const dot = name.lastIndexOf('.'); const stem = dot > 0 ? name.slice(0, dot) : name; const ext = dot > 0 ? name.slice(dot) : '';
      let n = 1; do { target = join(current, `${stem} - 복사본${n > 1 ? ` (${n})` : ''}${ext}`); n++; } while (data.files[target]);
    }
    const paths = Object.keys(data.files).filter(path => path === source || path.startsWith(source + '/'));
    for (const path of paths) data.files[target + path.slice(source.length)] = { ...data.files[path], modified: Date.now() };
    if (clipboard.cut) paths.forEach(path => delete data.files[path]);
  }
  if (writeFS(data)) { if (clipboard.cut) clipboard = null; selected.clear(); render(); }
}
function showMenu(x, y, actions) {
  const menu = $('#menu'); menu.replaceChildren();
  for (const [label, action] of actions) { const button = document.createElement('button'); button.textContent = label; button.onclick = () => { menu.hidden = true; action(); }; menu.append(button); }
  menu.hidden = false; menu.style.left = `${Math.max(0, Math.min(x, innerWidth - menu.offsetWidth - 4))}px`; menu.style.top = `${Math.max(0, Math.min(y, innerHeight - menu.offsetHeight - 4))}px`;
}
function contextActions() { return [['열기', () => { if (selected.size === 1) open([...selected][0]); }], ['잘라내기', () => copy(true)], ['복사', () => copy(false)], ['붙여넣기', paste], ['이름 바꾸기', rename], ['삭제', remove]]; }
const commands = [
  ['새로 만들기', 'add', event => showMenu(event.currentTarget.getBoundingClientRect().left, event.currentTarget.getBoundingClientRect().bottom, [['폴더', () => create('folder')], ['텍스트 문서', () => create('text')]])],
  ['잘라내기', 'cut', () => copy(true)], ['복사', 'copy', () => copy(false)], ['붙여넣기', 'paste', paste], ['이름 바꾸기', 'rename', rename], ['삭제', 'delete', remove],
  ['보기', 'view', event => showMenu(event.currentTarget.getBoundingClientRect().left, event.currentTarget.getBoundingClientRect().bottom, [['자세히', () => { view = 'details'; render(); }], ['큰 아이콘', () => { view = 'icons'; render(); }]])]
];
for (const [label, graphic, action] of commands) {
  const button = document.createElement('button'); button.className = 'btn'; button.title = label; button.setAttribute('aria-label', label); button.innerHTML = `${icon(graphic)}<span>${label}</span>`; button.onclick = action; $('#commands').append(button);
}
for (const [label, path, graphic] of [['홈', '/', 'view'], ['바탕 화면', '/바탕 화면', 'folder'], ['문서', '/문서', 'folder'], ['사진', '/사진', 'image']]) {
  const button = document.createElement('button'); button.className = 'nav-item'; button.dataset.path = path; button.innerHTML = `${icon(graphic)}<span>${label}</span>`; button.title = label; button.onclick = () => navigate(path); $('#sidebar').append(button);
}
$('#back').onclick = () => { if (historyIndex > 0) navigate(history[--historyIndex], false); };
$('#forward').onclick = () => { if (historyIndex < history.length - 1) navigate(history[++historyIndex], false); };
$('#up').onclick = () => { if (current !== '/') navigate(parent(current)); };
$('#search').oninput = () => { selected.clear(); render(); };
$('#list').oncontextmenu = event => { if (event.target === $('#list')) { event.preventDefault(); showMenu(event.clientX, event.clientY, [['새 폴더', () => create('folder')], ['새 텍스트 문서', () => create('text')], ['붙여넣기', paste]]); } };
document.addEventListener('click', event => { if (!$('#menu').contains(event.target)) $('#menu').hidden = true; });
window.addEventListener('keydown', event => {
  if ($('#dialog').open || event.target.matches('input')) return;
  if (event.key === 'F2') { event.preventDefault(); rename(); }
  if (event.key === 'Delete') { event.preventDefault(); remove(); }
  if (event.key === 'Enter' && selected.size === 1) { event.preventDefault(); open([...selected][0]); }
  if (event.ctrlKey && ['c', 'x', 'v'].includes(event.key.toLowerCase())) { event.preventDefault(); if (event.key.toLowerCase() === 'v') paste(); else copy(event.key.toLowerCase() === 'x'); }
});
window.addEventListener('storage', event => { if (event.key === 'win11web.fs') render(); });
seed(); render();
