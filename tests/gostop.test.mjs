import test from 'node:test';
import assert from 'node:assert/strict';
import { frameBlocked, probe, gostopTarget } from '../gostop.mjs';

const headers = (h) => new Headers(h);
const reply = (status, h = {}) => async () => ({ status, headers: headers(h), body: null });

test('frame blocking headers are recognised', () => {
  assert.equal(frameBlocked(headers({ 'x-frame-options': 'DENY' })), true);
  assert.equal(frameBlocked(headers({ 'x-frame-options': 'SAMEORIGIN' })), true);
  assert.equal(frameBlocked(headers({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" })), true);
  assert.equal(frameBlocked(headers({ 'content-security-policy': 'frame-ancestors *' })), false);
  assert.equal(frameBlocked(headers({})), false);
});

test('probe explains each failure', async () => {
  const target = { url: 'https://hwatu.example', configured: true };
  assert.equal((await probe(target, reply(200))).reason, 'ok');
  assert.equal((await probe(target, reply(503))).reason, 'starting');
  assert.equal((await probe(target, reply(200, { 'x-frame-options': 'DENY' }))).reason, 'frame-blocked');
  assert.equal((await probe(target, async () => { throw new TypeError('fetch failed'); })).reason, 'unreachable');
  assert.deepEqual(gostopTarget({}), { url: 'http://localhost:3000', configured: false });
  assert.deepEqual(gostopTarget({ GOSTOP_URL: ' https://a.b ' }), { url: 'https://a.b', configured: true });
});
