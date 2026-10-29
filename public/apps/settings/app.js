const page = document.querySelector('#page');
const title = document.querySelector('#page-title');
const navigation = document.querySelector('#navigation');
const sidebar = document.querySelector('.sidebar');
const sections = ['시스템', '개인 설정', '앱', '정보', '데이터 초기화'];
const icons = ['▣', '◈', '▦', 'ⓘ', '↻'];
let active = '시스템';
function read(key, fallback = '') { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
function write(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
function node(tag, text, className) { const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element; }
function card(titleText, detail) { const box = node('div', '', 'card'); const strong = node('strong', titleText); box.append(strong); if (detail) box.append(node('p', detail, 'muted')); return box; }
function storageUsage() {
  let bytes = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key && key.startsWith('win11web.')) bytes += (key.length + (localStorage.getItem(key) || '').length) * 2; } } catch {}
  return bytes;
}
function size(bytes) { return bytes < 1024 ? bytes + ' B' : bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1048576).toFixed(2) + ' MB'; }
function renderNavigation() {
  const query = document.querySelector('#search').value.trim().toLowerCase();
  const keywords = ['디스플레이 저장소', '테마 배경 화면 색', '프로그램', '브라우저 화면 장치', '삭제'];
  navigation.replaceChildren();
  sections.forEach((section, index) => {
    if (query && !section.includes(query) && !keywords[index].includes(query)) return;
    const button = node('button', icons[index] + '　' + section, 'btn' + (section === active ? ' active' : ''));
    button.onclick = () => { active = section; sidebar.classList.remove('open'); render(); };
    navigation.append(button);
  });
}
function choice(label, previewClass, selected, callback) {
  const button = node('button', '', 'choice' + (selected ? ' selected' : ''));
  button.setAttribute('aria-pressed', String(selected));
  button.append(node('div', '', 'preview ' + previewClass), node('span', label)); button.onclick = callback; return button;
}
function renderSystem() {
  page.append(card('디스플레이 정보', `${screen.width} × ${screen.height} 픽셀 · 배율 ${window.devicePixelRatio || 1}배`));
  const bytes = storageUsage(); const box = card('저장소 사용량', '이 브라우저에 저장된 win11web 데이터');
  const bar = node('div', '', 'bar'); const fill = node('span'); fill.style.width = Math.min(100, Math.max(bytes ? 1 : 0, bytes / (5 * 1024 * 1024) * 100)) + '%'; bar.append(fill);
  box.append(bar, node('small', `${size(bytes)} 사용 · 5 MB 기준`)); page.append(box);
}
function renderPersonal() {
  page.append(node('h2', '모드 선택')); const themes = node('div', '', 'cards');
  for (const [id, label] of [['light', '라이트'], ['dark', '다크']]) themes.append(choice(label, 'theme-' + id, read('win11web.theme', 'light') === id, () => { if (write('win11web.theme', id)) { document.documentElement.dataset.theme = id; render(); } }));
  page.append(themes, node('h2', '배경 화면')); const wallpapers = node('div', '', 'cards');
  for (const [id, label] of [['bloom', '블룸'], ['glow', '글로우'], ['sunrise', '일출'], ['night', '밤']]) wallpapers.append(choice(label, 'wp-' + id, read('win11web.wallpaper', 'bloom') === id, () => { write('win11web.wallpaper', id); render(); }));
  page.append(wallpapers, node('h2', '강조 색')); const row = node('div', '', 'card row'); const info = node('div'); info.append(node('strong', '사용자 지정 색'), node('small', '선택한 색을 저장합니다.'));
  const picker = document.createElement('input'); picker.type = 'color'; picker.setAttribute('aria-label', '강조 색'); picker.value = /^#[0-9a-f]{6}$/i.test(read('win11web.accent')) ? read('win11web.accent') : '#005fb8'; picker.oninput = () => write('win11web.accent', picker.value); row.append(info, picker); page.append(row);
}
async function renderApps() {
  const status = node('p', '앱 목록을 불러오는 중...', 'muted'); page.append(status);
  try {
    const response = await fetch('/apps/registry.json'); if (!response.ok) throw Error();
    const data = await response.json(); if (active !== '앱') return; status.remove();
    for (const app of data.apps) {
      if (!/^\/apps\/[a-z0-9-]+\/$/.test(app.url)) continue;
      const link = node('a', '', 'card app-link'); link.href = app.url; link.target = '_blank'; link.rel = 'noopener';
      link.append(node('span', `${app.icon || '▦'}　${app.name}`), node('span', '↗')); page.append(link);
    }
  } catch { if (active === '앱') status.textContent = '앱 목록을 불러올 수 없습니다.'; }
}
function renderInfo() { page.append(card('브라우저', navigator.userAgent), card('화면', `${screen.width} × ${screen.height} 픽셀 · 색상 ${screen.colorDepth}비트`), card('장치', `${navigator.platform || '알 수 없음'} · 언어 ${navigator.language || '알 수 없음'}`)); }
function renderReset() { const box = card('데이터 초기화', '설정, 앱 기록 및 가상 파일을 포함한 이 사이트의 win11web 데이터를 삭제합니다.'); const button = node('button', '초기화', 'btn'); button.onclick = () => document.querySelector('#reset-dialog').showModal(); box.append(button); page.append(box); }
function render() {
  title.textContent = active; document.title = active + ' - 설정'; page.replaceChildren(); renderNavigation();
  if (active === '시스템') renderSystem(); if (active === '개인 설정') renderPersonal(); if (active === '앱') renderApps(); if (active === '정보') renderInfo(); if (active === '데이터 초기화') renderReset();
}
document.querySelector('#search').oninput = renderNavigation;
document.querySelector('#back').onclick = () => sidebar.classList.toggle('open');
document.querySelector('#cancel-reset').onclick = () => document.querySelector('#reset-dialog').close();
document.querySelector('#confirm-reset').onclick = () => {
  try { const keys = []; for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key && key.startsWith('win11web.')) keys.push(key); } keys.forEach(key => localStorage.removeItem(key)); document.documentElement.dataset.theme = 'light'; document.querySelector('#reset-dialog').close(); active = '시스템'; render(); }
  catch { document.querySelector('#reset-dialog p').textContent = '데이터를 삭제할 수 없습니다. 브라우저 저장소 설정을 확인하세요.'; }
};
window.addEventListener('resize', () => { if (active === '시스템') render(); });
window.addEventListener('storage', () => render());
render();
