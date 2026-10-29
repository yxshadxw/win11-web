import test from 'node:test';
import assert from 'node:assert/strict';
import { weatherInfo } from '../public/apps/weather/rules.js';

test('WMO codes have Korean descriptions and appropriate groups', () => {
  const groups = { 0: 'clear', 1: 'clouds', 2: 'clouds', 3: 'clouds', 45: 'fog', 48: 'fog', 51: 'rain', 53: 'rain', 55: 'rain', 56: 'rain', 57: 'rain', 61: 'rain', 63: 'rain', 65: 'rain', 66: 'rain', 67: 'rain', 71: 'snow', 73: 'snow', 75: 'snow', 77: 'snow', 80: 'rain', 81: 'rain', 82: 'rain', 85: 'snow', 86: 'snow', 95: 'thunder', 96: 'thunder', 99: 'thunder' };
  for (const [code, group] of Object.entries(groups)) {
    const info = weatherInfo(Number(code));
    assert.equal(info.group, group);
    assert.match(info.label, /[가-힣]/);
    assert.notEqual(info.label, '날씨 정보 없음');
  }
});

test('unknown codes have a safe fallback', () => {
  assert.deepEqual(weatherInfo(999), { label: '날씨 정보 없음', group: 'clouds' });
});
