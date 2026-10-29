// Virtual PC: boots real x86 operating systems in the browser with v86 and hands them the
// user's programs on a generated FAT16 disk.
import { buildDisk, isWindowsExe } from './disk.js';
import { unzip } from './unzip.js';

const MB = 1024 * 1024;
const $ = (id) => document.getElementById(id);
const STORE = 'win11web.pc.';

const MACHINES = [
  { id: 'freedos', icon: '💾', name: 'FreeDOS', about: 'MS-DOS 호환 · 옛날 DOS 게임과 EXE 실행용', boot: 'fda', image: 'freedos', memory: 32 },
  { id: 'kolibri', icon: '🦅', name: 'KolibriOS', about: '플로피 한 장짜리 그래픽 운영체제 · 게임 포함', boot: 'fda', image: 'kolibri', memory: 64 },
  { id: 'linux', icon: '🐧', name: 'Linux (Buildroot)', about: '작은 리눅스 · 터미널', boot: 'cdrom', image: 'linux', memory: 64 },
  { id: 'own', icon: '🪟', name: '내 디스크 이미지', about: 'Windows 95/98, MS-DOS 등 직접 가진 이미지 (.img/.iso)', boot: 'own', memory: 128 },
];
const SIZES = { freedos: 737280, kolibri: 1474560, linux: 7731200 };

let machine = MACHINES[0];
let ownImage = null;
let files = [];
let emulator = null;
let starting = false;
let lastCount = 0;
let lastTick = 0;
let speedTimer = 0;

function read(key, fallback) {
  try { const v = localStorage.getItem(STORE + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* optional */ }
}
const formatSize = (n) => (n >= MB ? `${(n / MB).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

// ---------- saved states (IndexedDB, they are tens of MB) ----------
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('win11web.pc', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('states');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function stateOp(mode, fn) {
  const conn = await db();
  return new Promise((resolve, reject) => {
    const tx = conn.transaction('states', mode);
    const req = fn(tx.objectStore('states'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}
const stateKey = () => `${machine.id}:${machine.id === 'own' ? ownImage?.name : ''}`;

// ---------- machine list ----------
function renderMachines() {
  $('machines').replaceChildren(...MACHINES.map((m) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'machine';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(m === machine));
    b.innerHTML = `<span class="m-ico" aria-hidden="true">${m.icon}</span><strong></strong><small></small>`;
    b.querySelector('strong').textContent = m.name;
    b.querySelector('small').textContent = m.about;
    b.onclick = () => choose(m);
    li.append(b);
    return li;
  }));
  $('own-image').hidden = machine.id !== 'own';
  $('files-note').textContent = machine.id === 'freedos'
    ? 'FreeDOS에서는 C: 드라이브가 됩니다. ZIP은 풀어서 넣습니다.'
    : machine.id === 'own' ? '내 이미지로 부팅하면 두 번째 하드 디스크(D: 등)로 붙습니다.' : '이 운영체제에서는 두 번째 디스크로 붙습니다.';
}

function choose(m) {
  if (emulator) return;
  machine = m;
  $('memory').value = String(read(`memory.${m.id}`, m.memory));
  save('machine', m.id);
  renderMachines();
  refreshLoad();
}

// ---------- files ----------
async function addFiles(list) {
  $('error').textContent = '';
  for (const file of list) {
    const data = new Uint8Array(await file.arrayBuffer());
    if (/\.zip$/i.test(file.name)) {
      try {
        const entries = await unzip(data);
        const folder = file.name.replace(/\.zip$/i, '').slice(0, 30);
        // A zip with one top folder keeps it; otherwise its files go into a folder named after it.
        const tops = new Set(entries.map((e) => e.path.split('/')[0]));
        for (const e of entries) files.push({ path: tops.size === 1 && entries.length > 1 ? e.path : `${folder}/${e.path}`, data: e.data });
      } catch (err) {
        $('error').textContent = `${file.name}: ${err.message}`;
      }
    } else {
      files.push({ path: file.name, data });
    }
  }
  renderFiles();
}

function renderFiles() {
  $('file-list').replaceChildren(...files.map((f, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = f.path;
    name.title = f.path;
    li.append(name);
    if (/\.(exe|com|bat)$/i.test(f.path)) {
      const tag = document.createElement('small');
      tag.className = 'tag';
      tag.textContent = isWindowsExe(f.data) ? 'Windows' : 'DOS';
      li.append(tag);
    }
    const size = document.createElement('small');
    size.textContent = formatSize(f.data.length);
    const remove = document.createElement('button');
    remove.textContent = '✕';
    remove.setAttribute('aria-label', `${f.path} 빼기`);
    remove.onclick = () => { files.splice(i, 1); renderFiles(); };
    li.append(size, remove);
    return li;
  }));
  const winExe = files.some((f) => /\.exe$/i.test(f.path) && isWindowsExe(f.data));
  if (winExe && machine.id !== 'own') {
    $('error').textContent = 'Windows용 EXE가 있습니다. DOS에서는 실행되지 않으니 "내 디스크 이미지"로 Windows 98 등을 부팅해서 실행하세요.';
  }
  if (emulator) $('error').textContent = '파일은 다음 부팅 때 디스크에 들어갑니다.';
}

// ---------- emulator ----------
function setRunning(on) {
  for (const id of ['reset', 'cad', 'mouse', 'fullscreen', 'shot', 'save', 'type']) $(id).disabled = !on;
  $('power').querySelector('span:last-child').textContent = on ? '끄기' : '켜기';
  $('power').classList.toggle('primary', !on);
  $('idle').hidden = on;
  $('state').textContent = on ? `${machine.name} 실행 중` : '꺼짐';
  document.querySelectorAll('.machine').forEach((b) => { b.disabled = on; });
  refreshLoad();
}

async function refreshLoad() {
  try { $('load').disabled = !(await stateOp('readonly', (s) => s.count(stateKey()))); } catch { $('load').disabled = true; }
}

function progress(text, value) {
  $('progress').hidden = text === null;
  $('progress-text').textContent = text || '';
  if (value !== undefined) $('progress-bar').value = value;
}

async function start() {
  if (emulator || starting) return;
  $('error').textContent = '';
  if (machine.id === 'own' && !ownImage) {
    $('error').textContent = '먼저 디스크 이미지 파일을 고르세요.';
    $('image-file').click();
    return;
  }
  starting = true;
  progress('에뮬레이터를 불러오는 중…', 0);
  try {
    const { V86 } = await import('/vendor/v86/libv86.mjs');
    const memory = Number($('memory').value);
    save(`memory.${machine.id}`, memory);
    const options = {
      wasm_path: '/vendor/v86/v86.wasm',
      bios: { url: '/vendor/v86/seabios.bin' },
      vga_bios: { url: '/vendor/v86/vgabios.bin' },
      memory_size: memory * MB,
      vga_memory_size: Number($('vga').value) * MB,
      screen_container: $('screen'),
      acpi: $('acpi').checked,
      autostart: true,
    };
    const extra = files.length ? { buffer: buildDisk(files).buffer } : null;
    if (machine.image) {
      const image = { url: `/api/pc/image/${machine.image}`, size: SIZES[machine.image], async: false };
      options[machine.boot] = image;
      options.boot_order = machine.boot === 'cdrom' ? 0x213 : 0x321;
      if (extra) options.hda = extra;
    } else {
      const own = { buffer: ownImage };
      const iso = /\.iso$/i.test(ownImage.name);
      const floppy = !iso && ownImage.size <= 2949120;
      if (iso) { options.cdrom = own; options.boot_order = 0x213; }
      else if (floppy) { options.fda = own; options.boot_order = 0x321; }
      else { options.hda = own; options.boot_order = 0x132; }
      if (extra) options[floppy || iso ? 'hda' : 'hdb'] = extra;
    }
    emulator = new V86(options);
    emulator.add_listener('download-progress', (e) => {
      if (e.total) progress(`${e.file_name.split('/').pop()} 받는 중… ${formatSize(e.loaded)} / ${formatSize(e.total)}`, e.loaded / e.total);
    });
    emulator.add_listener('download-error', () => fail('디스크 이미지를 받지 못했습니다. 잠시 후 다시 시도하세요.'));
    emulator.add_listener('emulator-ready', () => {
      progress(null);
      setRunning(true);
      $('screen').focus();
      lastCount = 0;
      lastTick = performance.now();
      clearInterval(speedTimer);
      speedTimer = setInterval(updateSpeed, 1000);
      if (machine.id === 'freedos' && files.length) openDriveC();
    });
    emulator.add_listener('ide-read-start', () => { $('disk').textContent = '● 디스크'; });
    emulator.add_listener('ide-read-end', () => { $('disk').textContent = ''; });
  } catch (err) {
    fail(`시작하지 못했습니다: ${err.message}`);
  } finally {
    starting = false;
  }
}

// When the DOS prompt shows up, switch to the drive with the user's files.
async function openDriveC() {
  const current = emulator;
  const ready = await current.wait_until_vga_screen_contains(/[A-Z]:\\>/, { timeout_msec: 90_000 }).catch(() => false);
  if (ready && emulator === current) current.keyboard_send_text('C:\nDIR /W\n');
}

function updateSpeed() {
  if (!emulator) return;
  const count = emulator.get_instruction_counter();
  const now = performance.now();
  if (lastCount) $('speed').textContent = `${((count - lastCount) / ((now - lastTick) / 1000) / 1e6).toFixed(0)} MIPS`;
  lastCount = count;
  lastTick = now;
}

function fail(message) {
  stop();
  progress(null);
  $('error').textContent = message;
}

async function stop() {
  clearInterval(speedTimer);
  const current = emulator;
  emulator = null;
  setRunning(false);
  $('speed').textContent = '';
  if (current) {
    try { await current.destroy(); } catch { /* already gone */ }
  }
  const screen = $('screen');
  screen.querySelector('.text-layer').textContent = '';
  const canvas = screen.querySelector('canvas');
  canvas.style.display = 'none';
}

function screenshot() {
  const el = emulator.screen_make_screenshot();
  const url = el instanceof HTMLCanvasElement ? el.toDataURL('image/png') : el.src;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const path = `/사진/가상PC-${stamp}.png`;
  try {
    const fs = JSON.parse(localStorage.getItem('win11web.fs') || '{"files":{}}');
    fs.files ||= {};
    fs.files[path] = { type: 'image', content: url, modified: Date.now() };
    localStorage.setItem('win11web.fs', JSON.stringify(fs));
    if (window.parent !== window) window.parent.postMessage({ type: 'win11web-notify', title: '스크린샷 저장됨', body: path }, location.origin);
    $('state').textContent = `스크린샷: ${path}`;
  } catch {
    const a = Object.assign(document.createElement('a'), { href: url, download: `가상PC-${stamp}.png` });
    a.click();
  }
}

// ---------- wiring ----------
$('power').onclick = () => (emulator ? stop() : start());
$('idle-start').onclick = start;
$('reset').onclick = () => emulator?.restart();
$('cad').onclick = () => emulator?.keyboard_send_scancodes([0x1d, 0x38, 0x53, 0xd3, 0xb8, 0x9d]);
$('mouse').onclick = () => emulator?.lock_mouse();
$('fullscreen').onclick = () => emulator?.screen_go_fullscreen();
$('shot').onclick = () => emulator && screenshot();
$('save').onclick = async () => {
  if (!emulator) return;
  $('state').textContent = '상태 저장 중…';
  try {
    const state = await emulator.save_state();
    await stateOp('readwrite', (s) => s.put(state, stateKey()));
    $('state').textContent = `상태 저장됨 (${formatSize(state.byteLength)})`;
    refreshLoad();
  } catch (err) {
    $('state').textContent = `저장 실패: ${err.message}`;
  }
};
$('load').onclick = async () => {
  const state = await stateOp('readonly', (s) => s.get(stateKey())).catch(() => null);
  if (!state) return;
  if (!emulator) {
    await start();
    await new Promise((resolve) => emulator?.add_listener('emulator-ready', resolve));
  }
  try { await emulator.restore_state(state); $('state').textContent = '저장한 상태로 돌아왔습니다'; } catch (err) { $('error').textContent = `불러오기 실패: ${err.message}`; }
};
$('type').onclick = () => { $('type-text').value = ''; $('type-dialog').showModal(); };
$('type-dialog').addEventListener('close', () => {
  if ($('type-dialog').returnValue === 'send' && emulator) emulator.keyboard_send_text($('type-text').value);
  $('screen').focus();
});
$('panel-toggle').onclick = () => {
  const collapsed = document.querySelector('.layout').classList.toggle('collapsed');
  $('panel-toggle').setAttribute('aria-expanded', String(!collapsed));
};
$('files').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
$('image-file').onchange = (e) => {
  ownImage = e.target.files[0] || null;
  $('image-name').textContent = ownImage ? `${ownImage.name} (${formatSize(ownImage.size)})` : '디스크 이미지 선택';
  refreshLoad();
};
for (const target of [$('drop'), $('screen-wrap')]) {
  target.addEventListener('dragover', (e) => { e.preventDefault(); $('drop').classList.add('over'); });
  target.addEventListener('dragleave', () => $('drop').classList.remove('over'));
  target.addEventListener('drop', (e) => {
    e.preventDefault();
    $('drop').classList.remove('over');
    const dropped = [...e.dataTransfer.files];
    const image = dropped.find((f) => /\.(img|ima|iso|vhd|dsk)$/i.test(f.name));
    if (image && !emulator) {
      choose(MACHINES.find((m) => m.id === 'own'));
      ownImage = image;
      $('image-name').textContent = `${image.name} (${formatSize(image.size)})`;
    }
    addFiles(dropped.filter((f) => f !== image));
  });
}
window.addEventListener('beforeunload', () => { emulator?.destroy(); });

machine = MACHINES.find((m) => m.id === read('machine', 'freedos')) || MACHINES[0];
$('memory').value = String(read(`memory.${machine.id}`, machine.memory));
renderMachines();
setRunning(false);
