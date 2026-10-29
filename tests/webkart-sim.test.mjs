import test from 'node:test';
import assert from 'node:assert/strict';
import { createRace, stepRace, ranking, bestLapKey, updateProgress } from '../public/apps/webkart/sim.js';

for (const track of ['meadow', 'harbor']) {
  test(`${track}: AI completes a competitive race without getting stuck`, () => {
    const race = createRace(track);
    const last = race.racers.map(racer => racer.progress);
    const crossings = race.racers.map(() => []);
    for (let tick = 0; tick < 360 * 60 && race.racers.slice(1).some(racer => !racer.finishTime); tick++) {
      stepRace(race, 1 / 60, {});
      race.racers.slice(1).forEach((racer, index) => {
        const laps = Math.min(3, Math.floor(Math.max(0, racer.progress) / race.track.length));
        if (laps > crossings[index + 1].length) crossings[index + 1].push(race.time);
      });
      assert.deepEqual(ranking(race).map(racer => race.racers.indexOf(racer)).sort(), [0, 1, 2, 3]);
      if (tick % 600 === 599) {
        race.racers.slice(1).forEach((racer, index) => {
          if (!racer.finishTime) assert.ok(racer.progress > last[index + 1] + 100);
          last[index + 1] = racer.progress;
        });
      }
    }
    const times = race.racers.slice(1).map(racer => racer.finishTime);
    assert.ok(times.every(time => time > 0 && time < 360));
    assert.ok(Math.max(...times) / Math.min(...times) < 1.15);
    assert.ok(times.every(time => time < race.track.length * 3 / 180));
    for (let lap = 1; lap < 3; lap++) {
      const lapTimes = crossings.slice(1).map(times => times[lap] - times[lap - 1]);
      assert.ok(Math.max(...lapTimes) / Math.min(...lapTimes) < 1.15);
    }
    assert.match(bestLapKey(track), /^win11web\.webkart\./);
  });
}

test('reversing and crossing the start line repeatedly cannot add laps', () => {
  const race = createRace('meadow');
  const player = race.racers[0];
  player.progress = race.track.length - 5;
  player.lastS = race.track.length - 5;
  updateProgress(race.track, player, 5, 0);
  assert.equal(player.laps, 1);
  for (let i = 0; i < 10; i++) {
    updateProgress(race.track, player, race.track.length - 5, 0);
    updateProgress(race.track, player, 5, 0);
  }
  assert.equal(player.laps, 1);
});
