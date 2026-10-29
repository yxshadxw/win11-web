// Starts the ClassiCube web client (an Emscripten build) against this site's Classic server.
// ClassiCube reads its settings from window.Module before its script runs.
const params = new URLSearchParams(location.search);
const name = /^[A-Za-z0-9_.]{1,16}$/.test(params.get('name') || '') ? params.get('name') : 'Player';
const multi = params.get('mode') !== 'single';
const canvas = document.getElementById('canvas');
const status = document.getElementById('status');
const message = document.getElementById('message');
const progress = document.getElementById('progress');
const DEFAULT_CLIENT = 'https://cs.classicube.net/client/latest/ClassiCube.js';

function fit() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * ratio);
  canvas.height = Math.round(innerHeight * ratio);
}
fit();
addEventListener('resize', fit);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function fail(text) {
  status.hidden = false;
  progress.hidden = true;
  message.textContent = text;
}

// Server address = this page's host; TLS pages make the client use wss://.
const port = location.port || (location.protocol === 'https:' ? '443' : '80');
let total = 0;
window.Module = {
  arguments: multi ? [name, '', location.hostname, port] : [name],
  canvas,
  print: (text) => console.log(text),
  printErr: (text) => console.warn(text),
  setStatus(text) {
    if (!text) { status.hidden = true; return; }
    const m = /\((\d+(\.\d+)?)\/(\d+)\)/.exec(text);
    if (m) progress.value = Number(m[1]) / Number(m[3]);
    message.textContent = text.replace(/\(.*\)/, '').trim() || '불러오는 중…';
  },
  monitorRunDependencies(left) {
    total = Math.max(total, left);
    if (!left) status.hidden = true;
  },
  onAbort: () => fail('게임이 멈췄습니다. 새로 고침해서 다시 시작하세요.'),
};
addEventListener('error', (e) => {
  if (String(e.message || '').includes('WebGL')) fail('이 브라우저나 기기에서는 WebGL을 쓸 수 없어 게임을 실행할 수 없습니다.');
});

document.getElementById('full').onclick = () => document.documentElement.requestFullscreen?.().catch(() => {});

const config = await fetch('/config.json').then((r) => r.json()).catch(() => ({}));
const script = document.createElement('script');
script.src = config.classicubeClient || DEFAULT_CLIENT;
script.async = true;
script.onerror = () => fail('ClassiCube 게임 파일을 받지 못했습니다. 인터넷 연결이나 차단 프로그램을 확인하세요.');
document.body.append(script);
