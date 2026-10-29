import { sanitizeHTML, sortNotes } from './rules.js';
const key = 'win11web.sticky.notes';
const palette = ['#fff3a8', '#c7e9ff', '#d8f3cf', '#ffd4df', '#e8d8ff', '#ffe1bc', '#e3e4e8'];
const $ = selector => document.querySelector(selector);
let notes;
try { notes = JSON.parse(localStorage.getItem(key)) || []; if (!Array.isArray(notes)) notes = []; } catch { notes = []; }
let selected = notes[0]?.id || null;
const editor = $('#editor');
function save() { try { localStorage.setItem(key, JSON.stringify(notes)); } catch {} }
function current() { return notes.find(note => note.id === selected); }
function plain(html) { const el = document.createElement('div'); el.innerHTML = sanitizeHTML(html); return el.textContent || ''; }
function renderList() {
  const query = $('#search').value.toLocaleLowerCase();
  $('#list').replaceChildren();
  for (const note of sortNotes(notes).filter(n => plain(n.html).toLocaleLowerCase().includes(query))) {
    const button = document.createElement('button'); button.className = `item${note.id === selected ? ' selected' : ''}`;
    button.style.setProperty('--note-color', palette[note.color] || palette[0]);
    const title = document.createElement('strong'); title.textContent = plain(note.html).trim().replace(/\s+/g, ' ') || '새 메모';
    const time = document.createElement('small'); time.textContent = new Date(note.modified).toLocaleString('ko-KR');
    button.append(title, time); button.onclick = () => { selected = note.id; render(); }; $('#list').append(button);
  }
}
function render() {
  const note = current(); $('#empty').hidden = !!note; $('#note').hidden = !note; renderList();
  if (!note) return;
  $('#note').style.setProperty('--note-color', palette[note.color] || palette[0]); editor.innerHTML = sanitizeHTML(note.html);
  $('#colors').replaceChildren(); palette.forEach((color, index) => { const button = document.createElement('button'); button.className = 'color'; button.style.setProperty('--color', color); button.setAttribute('aria-label', `${index + 1}번 색상`); button.setAttribute('aria-pressed', String(index === note.color)); button.onclick = () => { note.color = index; note.modified = Date.now(); save(); render(); }; $('#colors').append(button); });
}
function add() { const note = { id: crypto.randomUUID(), html: '', color: 0, modified: Date.now() }; notes.push(note); selected = note.id; save(); render(); editor.focus(); }
$('#add').onclick = add; $('#empty-add').onclick = add; $('#search').oninput = renderList;
editor.addEventListener('input', () => { const note = current(); if (!note) return; note.html = sanitizeHTML(editor.innerHTML); note.modified = Date.now(); save(); renderList(); });
editor.addEventListener('paste', event => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); });
document.querySelectorAll('[data-command]').forEach(button => { button.addEventListener('mousedown', event => event.preventDefault()); button.onclick = () => { editor.focus(); document.execCommand(button.dataset.command); editor.dispatchEvent(new Event('input')); }; });
$('#delete').onclick = () => $('#confirm').showModal(); $('#cancel').onclick = () => $('#confirm').close();
$('#confirm-delete').onclick = () => { notes = notes.filter(note => note.id !== selected); selected = sortNotes(notes)[0]?.id || null; save(); $('#confirm').close(); render(); };
render();
