import { createTrack, sampleTrack, nearestTrack } from './track.js';
export const bestLapKey = id => 'win11web.webkart.best.' + id;
export function driftLevel(charge) {
  return charge >= 2.7 ? 3 : charge >= 1.65 ? 2 : charge >= 0.7 ? 1 : 0;
}
export function createRace(id) {
  const track = createTrack(id);
  const makeRacer = (name, color, distance, lane, skill) => {
    const point = sampleTrack(track, distance, lane);
    return { name, color, x: point.x, y: point.y, angle: point.angle,
      vx: 0, vy: 0, speed: 0, progress: distance,
      lastS: ((distance % track.length) + track.length) % track.length,
      lane, skill, charge: 0, boost: 0, padCooldown: 0, finishTime: 0,
      bumpX: 0, bumpY: 0, laps: 0 };
  };
  return { track, time: 0, lapTime: 0, racers: [
    makeRacer('나', '#53d7f3', -35, -28, 1),
    makeRacer('하늘', '#f27b75', -35, 28, 0.97),
    makeRacer('노을', '#f4c65e', -90, -28, 0.92),
    makeRacer('보라', '#bd9aeb', -90, 28, 0.88)
  ] };
}
export function updateProgress(track, racer, s, distance) {
  let delta = s - racer.lastS;
  if (delta > track.length / 2) delta -= track.length;
  if (delta < -track.length / 2) delta += track.length;
  if (Math.abs(delta) < 40 && distance < track.width / 2 + 115) racer.progress += delta;
  racer.lastS = s;
  const completed = Math.floor(Math.max(0, racer.progress) / track.length);
  if (completed > racer.laps) racer.laps = completed;
}
export function ranking(race) {
  return [...race.racers].sort((a, b) => {
    if (a.finishTime && b.finishTime) return a.finishTime - b.finishTime;
    if (a.finishTime) return -1;
    if (b.finishTime) return 1;
    return b.progress - a.progress;
  });
}
export function stepRace(race, dt, controls = {}, effects = {}) {
  controls = { up: false, down: false, left: false, right: false, drift: false, ...controls };
  const { track, racers } = race;
  const player = racers[0];
  const marks = effects.marks || [];
  const spawnParticle = effects.spawnParticle || (() => {});
  const boostSound = effects.boostSound || (() => {});
  const SPARKS = ['#87dfff', '#ffbd50', '#ef77f7'];
  race.time += dt;
  race.lapTime += dt;
  const raceTime = race.time;
  const previousLap = player.laps;
function updatePlayer(dt) {
  const near = nearestTrack(track, player.x, player.y);
  const onGrass = near.distance > track.width / 2;
  const steering = Number(controls.right) - Number(controls.left);
  const forwardX = Math.cos(player.angle);
  const forwardY = Math.sin(player.angle);
  let forwardSpeed = player.vx * forwardX + player.vy * forwardY;
  const drifting = controls.drift && Math.abs(forwardSpeed) > 80 && steering !== 0;

  if (controls.up) forwardSpeed += 210 * dt;
  if (controls.down) forwardSpeed -= (forwardSpeed > 0 ? 310 : 120) * dt;
  forwardSpeed *= Math.pow(onGrass ? 0.968 : 0.992, dt * 60);
  const maximum = onGrass ? 185 : player.boost > 0 ? 410 : 300;
  forwardSpeed = Math.max(-100, Math.min(maximum, forwardSpeed));

  const turnStrength = Math.min(1, Math.abs(forwardSpeed) / 115);
  player.angle += steering * 2.15 * turnStrength * (forwardSpeed < 0 ? -1 : 1) * (drifting ? 1.27 : 1) * dt;
  const newX = Math.cos(player.angle);
  const newY = Math.sin(player.angle);
  const lateral = player.vx * -newY + player.vy * newX;
  const grip = drifting ? 2.6 : onGrass ? 4 : 9;
  const remainingSide = lateral * Math.exp(-grip * dt);
  player.vx = newX * forwardSpeed - newY * remainingSide;
  player.vy = newY * forwardSpeed + newX * remainingSide;

  if (drifting) {
    player.charge = Math.min(3.4, player.charge + dt);
    if (Math.random() < 0.65) {
      const side = 9 * (Math.random() < 0.5 ? -1 : 1);
      const level = driftLevel(player.charge);
      const x = player.x - newX * 15 - newY * side;
      const y = player.y - newY * 15 + newX * side;
      marks.push({ x, y, angle: player.angle, life: 6 });
      if (level) spawnParticle(x, y, SPARKS[level - 1], 2 + Math.random() * 3, 0.3, -newX * 60, -newY * 60);
    }
  } else if (player.charge > 0) {
    const level = driftLevel(player.charge);
    if (level) {
      player.boost = 0.5 + level * 0.42;
      boostSound(level);
    }
    player.charge = 0;
  }

  if (player.boost > 0) {
    player.boost -= dt;
    player.vx += newX * 120 * dt;
    player.vy += newY * 120 * dt;
    if (Math.random() < 0.5) spawnParticle(player.x - newX * 19, player.y - newY * 19, '#78e6ff', 4, 0.28, -newX * 90, -newY * 90);
  }
  if (onGrass && Math.abs(forwardSpeed) > 50 && Math.random() < 0.35) {
    spawnParticle(player.x - newX * 12, player.y - newY * 12, '#ded2a1', 5 + Math.random() * 5, 0.7, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
  }

  player.x += player.vx * dt;
  player.y += player.vy * dt;
  player.speed = forwardSpeed;

  const boundary = nearestTrack(track, player.x, player.y);
  const wallDistance = track.width / 2 + 115;
  if (boundary.distance > wallDistance) {
    const nx = (player.x - boundary.x) / boundary.distance;
    const ny = (player.y - boundary.y) / boundary.distance;
    player.x = boundary.x + nx * wallDistance;
    player.y = boundary.y + ny * wallDistance;
    const outward = player.vx * nx + player.vy * ny;
    if (outward > 0) {
      player.vx -= nx * outward * 1.5;
      player.vy -= ny * outward * 1.5;
      player.vx *= 0.65;
      player.vy *= 0.65;
    }
  } else if (boundary.distance > track.width / 2 - 4 && boundary.distance < track.width / 2 + 10) {
    player.vx *= 0.985;
    player.vy *= 0.985;
  }

  updateProgress(track, player, boundary.s, boundary.distance);
  player.padCooldown = Math.max(0, player.padCooldown - dt);
  for (const fraction of track.pads) {
    const pad = sampleTrack(track, fraction * track.length);
    if (!player.padCooldown && Math.hypot(player.x - pad.x, player.y - pad.y) < 35) {
      player.boost = Math.max(player.boost, 1.1);
      player.padCooldown = 2;
      boostSound(1);
    }
  }
}

function updateAI(racer, dt, index) {
  if (racer.finishTime) return;
  const gap = player.progress - racer.progress;
  const rubberBand = Math.max(-0.08, Math.min(0.08, gap / track.length * 0.12));
  const look = sampleTrack(track, racer.progress + 100);
  const here = sampleTrack(track, racer.progress);
  let curve = look.angle - here.angle;
  while (curve > Math.PI) curve -= Math.PI * 2;
  while (curve < -Math.PI) curve += Math.PI * 2;
  const targetSpeed = (275 - Math.min(55, Math.abs(curve) * 95)) * (racer.skill + rubberBand);
  racer.speed += (targetSpeed - racer.speed) * Math.min(1, dt * 1.6);
  racer.progress += racer.speed * dt;
  const line = racer.lane + Math.sin(racer.progress / 280 + index) * (9 + index * 3);
  const point = sampleTrack(track, racer.progress, line);
  racer.bumpX *= Math.exp(-2.2 * dt);
  racer.bumpY *= Math.exp(-2.2 * dt);
  racer.x = point.x + racer.bumpX;
  racer.y = point.y + racer.bumpY;
  racer.angle = point.angle;
  if (racer.progress >= track.length * 3) racer.finishTime = raceTime;
}

function bumpRacers() {
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i];
      const b = racers[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 0.001;
      if (distance >= 26) continue;
      const nx = dx / distance;
      const ny = dy / distance;
      const push = (26 - distance) * 0.5;
      if (i === 0) {
        a.x -= nx * push;
        a.y -= ny * push;
        a.vx -= nx * 35;
        a.vy -= ny * 35;
      } else {
        a.bumpX -= nx * push;
        a.bumpY -= ny * push;
      }
      b.bumpX += nx * push;
      b.bumpY += ny * push;
      b.x += nx * push;
      b.y += ny * push;
    }
  }
}


  updatePlayer(dt);
  racers.slice(1).forEach((racer, index) => updateAI(racer, dt, index));
  bumpRacers();
  if (player.laps > previousLap) {
    race.completedLapTime = race.lapTime;
    race.lapTime = 0;
    if (player.laps >= 3) player.finishTime = race.time;
  } else {
    race.completedLapTime = 0;
  }
}
