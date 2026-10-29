const output = document.querySelector('#output');
const input = document.querySelector('#command');
const prompt = document.querySelector('#prompt');
const terminal = document.querySelector('#terminal');
const commands = ['help', 'ls', 'dir', 'cd', 'pwd', 'cat', 'type', 'mkdir', 'touch', 'rm', 'echo', 'clear', 'cls', 'date', 'whoami', 'history', 'tree', 'open', 'theme', 'sysinfo', 'calc'];
const defaults = ['/문서', '/사진', '/바탕 화면'];
let cwd = '/';
let history = [];
let historyIndex = 0;
let draft = '';
input.placeholder = ' ';

function readFS() {
  try { const data = JSON.parse(localStorage.getItem('win11web.fs')); return data && data.files && typeof data.files === 'object' ? data : { files: {} }; }
  catch { return { files: {} }; }
}
function writeFS(data) { localStorage.setItem('win11web.fs', JSON.stringify(data)); }
function resolve(path = '.') {
  const parts = (path.startsWith('/') ? path : `${cwd}/${path}`).split('/');
  const result = [];
  for (const part of parts) { if (part === '..') result.pop(); else if (part && part !== '.') result.push(part); }
  return '/' + result.join('/');
}
function isDir(path, files) { return path === '/' || defaults.includes(path) || files[path]?.type === 'folder' || Object.keys(files).some(name => name.startsWith(path + '/')); }
function parent(path) { return path.slice(0, path.lastIndexOf('/')) || '/'; }
function print(text = '') { output.append(document.createTextNode(text + '\n')); }
function updatePrompt() { prompt.textContent = `${cwd}> `; terminal.scrollTop = terminal.scrollHeight; }
function tokens(line) { return line.match(/"[^"]*"|'[^']*'|[^\s]+/g)?.map(part => part.replace(/^(["'])(.*)\1$/, '$2')) || []; }
function openTarget(target, files) {
  const path = resolve(target);
  const file = files[path];
  let id = target;
  let url;
  if (file) {
    id = file.type === 'image' ? 'photos' : file.type === 'text' ? 'notepad' : 'explorer';
    url = `/apps/${id}/?file=${encodeURIComponent(path)}`;
  } else {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('앱 또는 파일을 찾을 수 없습니다.');
    url = `/apps/${id}/`;
  }
  if (window.parent !== window) window.parent.postMessage({ type: 'win11web-open', id, url }, location.origin);
  else location.href = url;
}
function run(line) {
  const args = tokens(line);
  const command = (args.shift() || '').toLowerCase();
  const data = readFS();
  const files = data.files;
  const target = () => { if (!args[0]) throw new Error('경로를 입력하세요.'); return resolve(args[0]); };
  switch (command) {
    case 'help': print('명령: help, ls/dir, cd, pwd, cat/type, mkdir, touch, rm, echo, clear/cls, date, whoami, history, tree, open, theme, sysinfo, calc\n경로에 공백이 있으면 따옴표로 묶으세요. echo 내용 > 파일로 저장할 수 있습니다.\nTab: 자동 완성 · ↑/↓: 기록 · Ctrl+L: 지우기 · Ctrl+C: 취소'); break;
    case 'pwd': print(cwd); break;
    case 'cd': { const path = resolve(args[0] || '/'); if (!isDir(path, files)) throw new Error('폴더를 찾을 수 없습니다.'); cwd = path; break; }
    case 'ls': case 'dir': { const path = resolve(args[0] || '.'); if (!isDir(path, files)) throw new Error('폴더를 찾을 수 없습니다.'); const names = new Set([...defaults, ...Object.keys(files)].filter(name => name !== path && name.startsWith(path === '/' ? '/' : path + '/')).map(name => name.slice(path === '/' ? 1 : path.length + 1).split('/')[0])); print([...names].sort().join('  ') || '(비어 있음)'); break; }
    case 'cat': case 'type': { const file = files[target()]; if (!file || file.type !== 'text') throw new Error('텍스트 파일을 찾을 수 없습니다.'); print(file.content); break; }
    case 'mkdir': case 'touch': { const path = target(); if (files[path] || isDir(path, files)) throw new Error('이미 존재하는 경로입니다.'); if (!isDir(parent(path), files)) throw new Error('상위 폴더를 찾을 수 없습니다.'); files[path] = { type: command === 'mkdir' ? 'folder' : 'text', content: '', modified: Date.now() }; writeFS(data); break; }
    case 'rm': { const path = target(); if (!files[path] || defaults.includes(path)) throw new Error('삭제할 항목을 찾을 수 없습니다.'); if (Object.keys(files).some(name => name.startsWith(path + '/'))) throw new Error('폴더가 비어 있지 않습니다.'); delete files[path]; writeFS(data); break; }
    case 'echo': { const match = line.match(/^\s*echo\s+(.*?)\s*>\s*(.+?)\s*$/i); if (!match) { print(args.join(' ')); break; } const path = resolve(tokens(match[2])[0]); if (!isDir(parent(path), files) || isDir(path, files)) throw new Error('파일 경로가 올바르지 않습니다.'); files[path] = { type: 'text', content: match[1], modified: Date.now() }; writeFS(data); break; }
    case 'clear': case 'cls': output.replaceChildren(); break;
    case 'date': print(new Date().toLocaleString('ko-KR')); break;
    case 'whoami': print('사용자'); break;
    case 'history': print(history.map((item, index) => `${index + 1}  ${item}`).join('\n')); break;
    case 'tree': { const path = resolve(args[0] || '.'); if (!isDir(path, files)) throw new Error('폴더를 찾을 수 없습니다.'); const paths = new Set([...defaults, ...Object.keys(files)].filter(name => name.startsWith(path === '/' ? '/' : path + '/'))); print(path + '\n' + [...paths].sort().map(name => '  '.repeat(Math.max(0, name.slice(path === '/' ? 1 : path.length + 1).split('/').length - 1)) + '└─ ' + name.split('/').pop()).join('\n')); break; }
    case 'open': if (!args[0]) throw new Error('앱 ID 또는 파일 경로를 입력하세요.'); openTarget(args[0], files); break;
    case 'theme': if (!['light', 'dark'].includes(args[0])) throw new Error('theme light 또는 theme dark를 입력하세요.'); localStorage.setItem('win11web.theme', args[0]); document.documentElement.dataset.theme = args[0]; break;
    case 'sysinfo': print(`  ▄▄▄▄ ▄▄▄▄   Windows 웹 데스크톱\n  ████ ████   브라우저: ${navigator.userAgent}\n  ████ ████   화면: ${screen.width} × ${screen.height}\n  ▀▀▀▀ ▀▀▀▀   언어: ${navigator.language}`); break;
    case 'calc': print(String(calculate(line.slice(line.toLowerCase().indexOf('calc') + 4)))); break;
    case '': break;
    default: print(`알 수 없는 명령: ${command}. help를 입력하세요.`);
  }
}
document.querySelector('#command-form').onsubmit = event => {
  event.preventDefault();
  const line = input.value;
  print(`${cwd}> ${line}`);
  if (line.trim()) { history.push(line); historyIndex = history.length; draft = ''; try { run(line); } catch (error) { print(`오류: ${error.message}`); } }
  input.value = ''; updatePrompt();
};
input.onkeydown = event => {
  if (event.ctrlKey && event.key.toLowerCase() === 'l') { event.preventDefault(); output.replaceChildren(); }
  else if (event.ctrlKey && event.key.toLowerCase() === 'c') { event.preventDefault(); print(`${cwd}> ${input.value}^C`); input.value = ''; historyIndex = history.length; updatePrompt(); }
  else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); if (historyIndex === history.length) draft = input.value; historyIndex = Math.max(0, Math.min(history.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1))); input.value = historyIndex === history.length ? draft : history[historyIndex]; }
  else if (event.key === 'Tab') {
    event.preventDefault();
    const before = input.value.slice(0, input.selectionStart);
    const match = before.match(/(?:^|\s)("[^"]*|[^\s"]*)$/);
    if (!match) return;
    const fragment = match[1].replace(/^"/, '');
    let candidates;
    if (!before.trim().includes(' ')) candidates = commands.filter(name => name.startsWith(fragment));
    else { const path = resolve(fragment || '.'); const dir = fragment.endsWith('/') ? path : parent(path); const prefix = fragment.endsWith('/') ? '' : path.split('/').pop(); candidates = [...new Set([...defaults, ...Object.keys(readFS().files)].filter(name => parent(name) === dir && name.split('/').pop().startsWith(prefix)).map(name => (fragment.includes('/') ? fragment.slice(0, fragment.lastIndexOf('/') + 1) : '') + name.split('/').pop() + (isDir(name, readFS().files) ? '/' : '')))]; }
    if (candidates.length === 1) { const value = candidates[0]; const quoted = value.includes(' ') || match[1].startsWith('"'); input.value = before.slice(0, before.length - match[1].length) + (quoted ? `"${value}"` : value) + input.value.slice(input.selectionStart); }
    else if (candidates.length > 1) { print(candidates.join('  ')); updatePrompt(); }
  }
};
terminal.addEventListener('click', () => input.focus());
print('Windows 웹 터미널\n도움말을 보려면 help를 입력하세요.\n');
updatePrompt(); input.focus();
