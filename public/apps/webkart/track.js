const definitions = {
  meadow: {
    name: '초록 바람 서킷',
    ground: '#7aac79',
    field: '#89b986',
    road: '#59656a',
    points: [[-650,-350],[-150,-440],[400,-400],[720,-180],[680,140],[400,350],[40,300],[-240,470],[-650,370],[-800,40]]
  },
  harbor: {
    name: '노을 항구 서킷',
    ground: '#c39d75',
    field: '#d0ae88',
    road: '#59636c',
    points: [[-720,-310],[-310,-430],[90,-290],[400,-430],[760,-230],[760,100],[500,220],[270,80],[70,350],[-300,420],[-690,280],[-810,0]]
  }
};

function curve(a, b, c, d, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * b) + (-a + c) * t +
    (2 * a - 5 * b + 4 * c - d) * t2 +
    (-a + 3 * b - 3 * c + d) * t3);
}

export function createTrack(id) {
  const definition = definitions[id] || definitions.meadow;
  const controls = definition.points;
  const points = [];
  for (let i = 0; i < controls.length; i++) {
    const a = controls[(i - 1 + controls.length) % controls.length];
    const b = controls[i];
    const c = controls[(i + 1) % controls.length];
    const d = controls[(i + 2) % controls.length];
    for (let j = 0; j < 24; j++) {
      const t = j / 24;
      points.push({ x: curve(a[0], b[0], c[0], d[0], t), y: curve(a[1], b[1], c[1], d[1], t) });
    }
  }
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const next = points[(i + 1) % points.length];
    p.s = length;
    p.segment = Math.hypot(next.x - p.x, next.y - p.y);
    p.angle = Math.atan2(next.y - p.y, next.x - p.x);
    length += p.segment;
  }
  return { ...definition, id, points, length, width: 150, pads: [0.18, 0.49, 0.77] };
}

export function sampleTrack(track, distance, offset = 0) {
  const s = ((distance % track.length) + track.length) % track.length;
  let low = 0;
  let high = track.points.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (track.points[mid].s <= s) low = mid;
    else high = mid - 1;
  }
  const point = track.points[low];
  const next = track.points[(low + 1) % track.points.length];
  const t = (s - point.s) / point.segment;
  return {
    x: point.x + (next.x - point.x) * t - Math.sin(point.angle) * offset,
    y: point.y + (next.y - point.y) * t + Math.cos(point.angle) * offset,
    angle: point.angle
  };
}

export function nearestTrack(track, x, y) {
  let best = null;
  for (let i = 0; i < track.points.length; i++) {
    const p = track.points[i];
    const q = track.points[(i + 1) % track.points.length];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / (dx * dx + dy * dy)));
    const px = p.x + dx * t;
    const py = p.y + dy * t;
    const distance = Math.hypot(x - px, y - py);
    if (!best || distance < best.distance) {
      best = { x: px, y: py, distance, s: p.s + p.segment * t, angle: p.angle };
    }
  }
  return best;
}
