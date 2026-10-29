import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedAddress, normalizeTarget, proxify, rewriteHtml, rewriteCss, ProxyError } from '../proxy.mjs';

test('blocks private, loopback and link-local addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
});

test('allows public addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test('normalizeTarget adds https and rejects non-http schemes and internal hosts', () => {
  assert.equal(normalizeTarget('example.com').href, 'https://example.com/');
  assert.equal(normalizeTarget('http://example.com/a#x').href, 'http://example.com/a');
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x.com', 'http://127.0.0.1/',
    'http://localhost:3000', 'http://[::1]/', 'http://user:pw@example.com', '']) {
    assert.throws(() => normalizeTarget(bad), ProxyError, bad);
  }
});

test('proxify resolves relative URLs and leaves special schemes alone', () => {
  assert.equal(proxify('/a?b=1', 'https://x.com/p/'), '/proxy?url=' + encodeURIComponent('https://x.com/a?b=1'));
  assert.equal(proxify('img.png', 'https://x.com/p/'), '/proxy?url=' + encodeURIComponent('https://x.com/p/img.png'));
  assert.equal(proxify('#top', 'https://x.com/'), '#top');
  assert.equal(proxify('javascript:void 0', 'https://x.com/'), 'javascript:void 0');
  assert.equal(proxify('data:image/png;base64,AA', 'https://x.com/'), 'data:image/png;base64,AA');
});

test('rewriteHtml routes links, assets and forms through the proxy', () => {
  const html = '<html><head><meta http-equiv="Content-Security-Policy" content="x"><base href="/z/"></head>'
    + '<body><a href="/next">n</a><img src="i.png" srcset="a.png 1x, b.png 2x">'
    + '<form action="/search"><input name="q"></form><div style="background:url(bg.png)"></div>'
    + '<script src="s.js" integrity="sha-1"></script></body></html>';
  const out = rewriteHtml(html, 'https://x.com/dir/page');
  const p = (u) => '/proxy?url=' + encodeURIComponent(u);
  assert.ok(out.includes(`href="${p('https://x.com/next')}"`));
  assert.ok(out.includes(`src="${p('https://x.com/dir/i.png')}"`));
  assert.ok(out.includes(`${p('https://x.com/dir/b.png')} 2x`));
  assert.ok(out.includes(`action="${p('https://x.com/search')}"`));
  assert.ok(out.includes('data-orig-action="https://x.com/search"'));
  assert.ok(out.includes(`url(${p('https://x.com/dir/bg.png')})`));
  assert.ok(!/Content-Security-Policy/i.test(out));
  assert.ok(!/<base/i.test(out));
  assert.ok(!/integrity=/.test(out));
  assert.ok(out.includes('win11web-proxy-nav'));
});

test('rewriteCss rewrites url() and @import', () => {
  const out = rewriteCss('@import "a.css"; body{background:url(\'/b.png\')}', 'https://x.com/c/main.css');
  assert.ok(out.includes('@import "/proxy?url=' + encodeURIComponent('https://x.com/c/a.css') + '"'));
  assert.ok(out.includes("url('/proxy?url=" + encodeURIComponent('https://x.com/b.png') + "')"));
});
