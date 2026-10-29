// Boot splash on first load of a session, then a lock screen that any key or click dismisses.
import { $ } from './util.js';

const SEEN_KEY = 'win11web.booted';

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tickLock() {
  const now = new Date();
  $('#lock-time').textContent = now.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: false });
  $('#lock-date').textContent = now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
}

/** Shows the lock screen and resolves once the user unlocks. */
export function lock() {
  const screen = $('#lock-screen');
  screen.hidden = false;
  screen.classList.remove('unlocking', 'signin');
  tickLock();
  const timer = setInterval(tickLock, 10_000);
  screen.focus();
  return new Promise((resolve) => {
    const unlock = async (e) => {
      if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
      screen.removeEventListener('pointerdown', unlock);
      screen.removeEventListener('keydown', unlock);
      screen.classList.add('signin');
      await wait(650);
      screen.classList.add('unlocking');
      await wait(350);
      clearInterval(timer);
      screen.hidden = true;
      resolve();
    };
    screen.addEventListener('pointerdown', unlock);
    screen.addEventListener('keydown', unlock);
  });
}

/** Boot splash + lock screen once per browser session; skipped for deep links. */
export async function boot({ skip }) {
  let seen = false;
  try { seen = sessionStorage.getItem(SEEN_KEY) === '1'; sessionStorage.setItem(SEEN_KEY, '1'); } catch { seen = true; }
  const splash = $('#boot-screen');
  if (seen || skip || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    splash.remove();
    return;
  }
  splash.hidden = false;
  await wait(1400);
  splash.classList.add('done');
  await wait(300);
  splash.remove();
  await lock();
}
