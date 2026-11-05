import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedAddress, normalizeTarget, proxify, rewriteHtml, rewriteCss, ProxyError } from '../proxy.mjs';

test('blocks private, loopback and link-local addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
});

test('blocks IPv4 embedded in IPv6 in every spelling', () => {
  for (const ip of ['::ffff:7f00:1', '::ffff:0a00:0001', '0:0:0:0:0:ffff:7f00:1', '::7f00:1', '::127.0.0.1',
    '::ffff:a9fe:a9fe', '::ffff:0:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::', '2001:0:4136:e378::1', 'fec0::1', 'fe80::1%eth0']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  // Node's URL parser rewrites the dotted form to hex; the normalized host must still be blocked.
  assert.throws(() => normalizeTarget('http://[::ffff:127.0.0.1]/'), ProxyError);
  assert.throws(() => normalizeTarget('http://[::ffff:169.254.169.254]/'), ProxyError);
  assert.equal(isBlockedAddress('::ffff:808:808'), false); // 8.8.8.8 mapped is public
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

test('stylesheet requests get a CSS type even when the site labels it otherwise', async () => {
  const { stylesheetType } = await import('../proxy.mjs');
  assert.equal(stylesheetType('text/plain', 'style'), 'text/css; charset=utf-8');
  assert.equal(stylesheetType('application/octet-stream', 'style'), 'text/css; charset=utf-8');
  assert.equal(stylesheetType('text/css; charset=utf-8', 'style'), 'text/css; charset=utf-8');
  assert.equal(stylesheetType('text/html', 'style'), 'text/html', 'an HTML error page is not restyled');
  assert.equal(stylesheetType('text/plain', 'image'), 'text/plain', 'other requests are untouched');
  assert.equal(stylesheetType('text/plain', undefined), 'text/plain');
});

test('page loads and sub-resources have separate rate budgets', async () => {
  const { rateLimited } = await import('../proxy.mjs');
  const now = Date.now();
  // 240 document requests are fine, the 241st is limited.
  for (let i = 0; i < 240; i++) assert.equal(rateLimited(`doc-${now}`, now, 240), false);
  assert.equal(rateLimited(`doc-${now}`, now, 240), true);
  // A page's ~250 sub-resources under the asset budget do not hit the document limit.
  for (let i = 0; i < 250; i++) assert.equal(rateLimited(`doc-${now}|assets`, now, 3000), false);
});

test('cookies are scoped per host, path and session, and never leak across sessions', async () => {
  const { storeCookies, cookieHeader, newSessionId, validSession, parseSetCookie } = await import('../proxy.mjs');
  const site = new URL('https://login.example.com/session');
  const a = newSessionId();
  const b = newSessionId();
  assert.equal(validSession(a), a);
  assert.equal(validSession('../../x'), null);
  storeCookies(a, site, ['user_session=abc; Path=/; Secure; HttpOnly', 'theme=dark; Domain=example.com; Path=/']);
  assert.equal(cookieHeader(a, new URL('https://login.example.com/other')), 'user_session=abc; theme=dark');
  assert.equal(cookieHeader(a, new URL('https://other.org/')), '', 'no cookies for other sites');
  assert.equal(cookieHeader(a, new URL('http://login.example.com/')), 'theme=dark', 'secure cookies need https');
  assert.equal(cookieHeader(b, new URL('https://login.example.com/')), '', 'another session sees nothing');
  // a site may not set cookies for a bare top-level domain or for a foreign domain
  assert.equal(parseSetCookie('x=1; Domain=com', site), null);
  assert.equal(parseSetCookie('x=1; Domain=evil.net', site), null);
  // Max-Age=0 removes the cookie
  storeCookies(a, site, ['user_session=; Max-Age=0; Path=/']);
  assert.equal(cookieHeader(a, new URL('https://login.example.com/')), 'theme=dark');
});

test('documents carry their session id into links and forms', () => {
  const sid = 'a'.repeat(32);
  const html = rewriteHtml('<head></head><a href="/next">x</a><form action="/session"></form>', 'https://github.com/login', sid);
  assert.match(html, new RegExp(`href="/proxy\\?url=https%3A%2F%2Fgithub\\.com%2Fnext&amp;s=${sid}"`));
  assert.match(html, new RegExp(`action="/proxy\\?url=https%3A%2F%2Fgithub\\.com%2Fsession&amp;s=${sid}"`));
  assert.match(html, new RegExp(`S="${sid}"`), 'the page script knows its session');
});
