const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const source = fs.readFileSync(__dirname + '/../public/apps/webkart/track.js', 'utf8');
  const trackModule = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  for (const id of ['meadow', 'harbor']) {
    const track = trackModule.createTrack(id);
    assert.ok(track.points.length > 100, 'closed spline has enough samples');
    assert.ok(track.length > 1000, 'track has a usable length');
    const start = trackModule.sampleTrack(track, 0);
    const wrapped = trackModule.sampleTrack(track, track.length);
    assert.ok(Math.hypot(start.x - wrapped.x, start.y - wrapped.y) < 0.001, 'track wraps');
    const near = trackModule.nearestTrack(track, start.x, start.y);
    assert.ok(near.distance < 0.001, 'nearest point finds the road');
  }
  console.log('Track geometry checks passed');
})();
