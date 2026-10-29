const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('both standalone games provide their entry points', () => {
  for (const game of ['shooter', 'typing']) {
    const html = fs.readFileSync(`public/apps/${game}/index.html`, 'utf8');
    assert.match(html, /\/shared\/app\.css/);
    assert.match(html, /\/shared\/theme\.js/);
    assert.match(html, /app\.js/);
  }
});
