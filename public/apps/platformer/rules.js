export function resolveAxis(body, delta, axis, solids) {
  const other = axis === 'x' ? 'y' : 'x';
  const size = axis === 'x' ? 'w' : 'h';
  const otherSize = axis === 'x' ? 'h' : 'w';
  let allowed = delta;
  for (const tile of solids) {
    if (body[other] >= tile[other] + tile[otherSize] || body[other] + body[otherSize] <= tile[other]) continue;
    if (delta > 0 && body[axis] + body[size] <= tile[axis]) allowed = Math.min(allowed, tile[axis] - body[axis] - body[size]);
    if (delta < 0 && body[axis] >= tile[axis] + tile[size]) allowed = Math.max(allowed, tile[axis] + tile[size] - body[axis]);
  }
  return allowed;
}
