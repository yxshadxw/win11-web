export const WIDTH = 400, HEIGHT = 700, GOAL_LEFT = 130, GOAL_RIGHT = 270;
export function collide(puck, mallet) {
  const dx = puck.x - mallet.x, dy = puck.y - mallet.y;
  const distance = Math.hypot(dx, dy), reach = puck.r + mallet.r;
  if (distance >= reach) return false;
  const nx = distance ? dx / distance : 0, ny = distance ? dy / distance : 1;
  puck.x = mallet.x + nx * reach; puck.y = mallet.y + ny * reach;
  const relative = (puck.vx - mallet.vx) * nx + (puck.vy - mallet.vy) * ny;
  if (relative < 0) { puck.vx -= 1.9 * relative * nx; puck.vy -= 1.9 * relative * ny; }
  return true;
}
export function stepPuck(puck, dt) {
  puck.x += puck.vx * dt; puck.y += puck.vy * dt;
  if (puck.x < puck.r || puck.x > WIDTH - puck.r) {
    puck.x = Math.max(puck.r, Math.min(WIDTH - puck.r, puck.x)); puck.vx *= -0.94;
  }
  if (puck.y < puck.r || puck.y > HEIGHT - puck.r) {
    if (puck.x > GOAL_LEFT + puck.r && puck.x < GOAL_RIGHT - puck.r) return puck.y < puck.r ? 'bottom' : 'top';
    puck.y = Math.max(puck.r, Math.min(HEIGHT - puck.r, puck.y)); puck.vy *= -0.94;
  }
  const drag = Math.pow(0.985, dt * 60); puck.vx *= drag; puck.vy *= drag;
  const speed = Math.hypot(puck.vx, puck.vy);
  if (speed > 850) { puck.vx *= 850 / speed; puck.vy *= 850 / speed; }
  return null;
}
