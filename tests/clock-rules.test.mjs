import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { formatDuration, alarmDue, lapStats } from '../public/apps/clock/rules.js';

test('duration rounds up and formats hours', () => {
  assert.equal(formatDuration  (3661001), '01:01:02');
  assert.equal(formatDuration(0), '00:00:00');
});
test('alarm matches time and repeat day only', () => {
  const date = new Date(2026, 9, 30, 8, 15);
  assert.equal(alarmDue({ enabled: true, time: '08:15', days: [5] }, date), true);
  assert.equal(alarmDue({ enabled: true, time: '08:15', days: [1] }, date), false);
});
test('lap statistics identify shortest and longest', () => {
  assert.deepEqual(lapStats([300, 100, 200]), { best: 100, worst: 300 });
});
