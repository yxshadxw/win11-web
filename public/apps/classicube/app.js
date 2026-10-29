// Launcher: picks a name, shows who is on the shared world, then opens the game page.
const $ = (id) => document.getElementById(id);
const KEY = 'win11web.classicube.name';
const VALID = /^[A-Za-z0-9_.]{1,16}$/;

try { $('name').value = localStorage.getItem(KEY) || ''; } catch { /* optional */ }
if (!$('name').value) $('name').value = `Player${Math.floor(Math.random() * 9000 + 1000)}`;

$('play').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('name').value.trim();
  if (!VALID.test(name)) {
    $('error').textContent = '닉네임은 영문, 숫자, _ 와 . 로 16자까지 쓸 수 있어요.';
    return;
  }
  try { localStorage.setItem(KEY, name); } catch { /* optional */ }
  const mode = e.submitter?.value === 'single' ? 'single' : 'multi';
  location.href = `play.html?${new URLSearchParams({ mode, name })}`;
});

async function refresh() {
  try {
    const res = await fetch('/api/classic/status', { cache: 'no-store' });
    const s = await res.json();
    $('dot').className = 'dot on';
    $('server-name').textContent = s.name;
    $('count').textContent = `${s.players.length} / ${s.max}명 · 월드 ${s.size.join('×')}`;
    $('motd').textContent = s.motd;
    $('who').replaceChildren(...s.players.map((p) => Object.assign(document.createElement('li'), { textContent: p })));
  } catch {
    $('dot').className = 'dot off';
    $('server-name').textContent = '서버에 연결할 수 없어요 (싱글플레이는 됩니다)';
    $('count').textContent = '';
  }
}
refresh();
setInterval(refresh, 5000);
