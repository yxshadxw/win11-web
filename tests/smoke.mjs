// Browser smoke test: loads the desktop and every app page, collects console errors,
// and saves screenshots. Usage: node tests/smoke.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:3100';
const out = process.argv[3] || 'tests/screenshots';
mkdirSync(out, { recursive: true });

const { apps } = JSON.parse(readFileSync(new URL('../public/apps/registry.json', import.meta.url), 'utf8'));
const browser = await chromium.launch();
const problems = [];

async function visit(name, url, viewport, action, { boot = false } = {}) {
  const page = await browser.newPage({ viewport });
  // Skip the boot splash and lock screen unless a test asks for them.
  if (!boot) await page.addInitScript(() => sessionStorage.setItem('win11web.booted', '1'));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${name}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  await page.goto(base + url, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  if (action) await action(page);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
}

await visit('lock', '/', { width: 1366, height: 800 }, async (page) => {
  await page.waitForTimeout(1600);
  if (!(await page.locator('#lock-screen').isVisible())) problems.push('lock: lock screen not shown on first visit');
}, { boot: true });
await visit('desktop', '/', { width: 1366, height: 800 }, async (page) => {
  const broken = await page.$$eval('.app-icon img', (imgs) => imgs.filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src));
  if (broken.length) problems.push(`desktop: broken icons ${broken.join(', ')}`);
});
await visit('quick-settings', '/', { width: 1366, height: 800 }, async (page) => { await page.click('#tray-btn'); await page.waitForTimeout(300); });
await visit('calendar', '/', { width: 1366, height: 800 }, async (page) => { await page.click('#clock-btn'); await page.waitForTimeout(300); });
await visit('start', '/', { width: 1366, height: 800 }, async (page) => { await page.click('#start-btn'); await page.waitForTimeout(300); });
await visit('snap-flyout', '/?open=notepad', { width: 1366, height: 800 }, async (page) => {
  await page.hover('.window [data-act="max"]'); await page.waitForTimeout(700);
  if (!(await page.locator('.snap-flyout').isVisible())) problems.push('snap-flyout: not shown on hover');
  await page.locator('.snap-zone').first().click();
  const w = await page.locator('.window').boundingBox();
  if (Math.abs(w.width - 683) > 4) problems.push(`snap-flyout: zone width ${w.width}`);
});
await visit('widgets', '/', { width: 1366, height: 800 }, async (page) => {
  await page.click('#widget-btn'); await page.waitForTimeout(1500);
  if (!(await page.locator('#widgets').isVisible())) problems.push('widgets: panel not shown');
});
await visit('task-view', '/?open=notepad,calculator,chess', { width: 1366, height: 800 }, async (page) => {
  await page.waitForTimeout(800);
  await page.click('#taskview-btn'); await page.waitForTimeout(400);
  const cards = await page.locator('.tv-card').count();
  if (cards !== 3) problems.push(`task-view: expected 3 cards, got ${cards}`);
});
await visit('start-all', '/', { width: 1366, height: 800 }, async (page) => {
  await page.click('#start-btn'); await page.click('#all-apps'); await page.waitForTimeout(300);
});
await visit('marquee', '/', { width: 1366, height: 800 }, async (page) => {
  await page.mouse.move(600, 400); await page.mouse.down(); await page.mouse.move(5, 5, { steps: 6 });
  await page.screenshot({ path: `${out}/marquee-drag.png` }); await page.mouse.up();
  const n = await page.locator('.desk-icon.selected').count();
  if (n < 3) problems.push(`marquee: only ${n} icons selected`);
});
await visit('desktop-mobile', '/?open=notepad', { width: 390, height: 844 });
await visit('desktop-windows', '/?open=explorer,calculator', { width: 1366, height: 800 }, async (page) => {
  const sizes = await page.$$eval('.window', (els) => els.map((e) => [e.offsetWidth, e.offsetHeight]));
  for (const [w, h] of sizes) if (h < 300) problems.push(`desktop-windows: window too small ${w}x${h}`);
});
for (const app of apps) {
  if (app.id === 'gostop') continue; // depends on a separate server
  await visit(`app-${app.id}`, app.url, { width: 1000, height: 680 });
}
await visit('app-webkart-dark', '/apps/webkart/', { width: 1000, height: 680 }, async (page) => {
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
});

await browser.close();
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'OK: no console errors');
process.exitCode = problems.length ? 1 : 0;
