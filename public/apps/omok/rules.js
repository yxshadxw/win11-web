const directions = [[1,0],[0,1],[1,1],[1,-1]];
const valid = (x, y) => x >= 0 && x < 15 && y >= 0 && y < 15;
export function winner(board, index) {
  const color = board[index]; if (!color) return null;
  const x = index % 15, y = Math.floor(index / 15);
  for (const [dx, dy] of directions) {
    const line = [index];
    for (const sign of [-1, 1]) {
      let nx = x + dx * sign, ny = y + dy * sign;
      while (valid(nx, ny) && board[ny * 15 + nx] === color) { line.push(ny * 15 + nx); nx += dx * sign; ny += dy * sign; }
    }
    if (line.length >= 5) return { color, line };
  }
  return null;
}
function potential(board, index, color) {
  const x = index % 15, y = Math.floor(index / 15); let score = 0;
  for (const [dx, dy] of directions) {
    let count = 1, open = 0;
    for (const sign of [-1, 1]) {
      let nx = x + dx * sign, ny = y + dy * sign;
      while (valid(nx, ny) && board[ny * 15 + nx] === color) { count++; nx += dx * sign; ny += dy * sign; }
      if (valid(nx, ny) && !board[ny * 15 + nx]) open++;
    }
    score += count >= 5 ? 1000000 : count === 4 ? (open === 2 ? 50000 : 12000) : count === 3 ? (open === 2 ? 5000 : 500) : count === 2 ? (open === 2 ? 180 : 30) : 2;
  }
  return score;
}
function candidatesFor(board, color, level) {
  const opponent = 3 - color, candidates = [];
  for (let i = 0; i < 225; i++) if (!board[i]) {
    const x = i % 15, y = Math.floor(i / 15);
    if (board.some(Boolean) && !board.some((v, j) => v && Math.abs(j % 15 - x) <= 2 && Math.abs(Math.floor(j / 15) - y) <= 2)) continue;
    const own = potential(board, i, color), defense = potential(board, i, opponent);
    candidates.push({ i, score: own * (level === 1 ? 1 : 1.1) + defense * (level === 1 ? .5 : 1) + (14 - Math.abs(x - 7) - Math.abs(y - 7)) });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}
export function chooseMove(board, color, level = 3) {
  const candidates = candidatesFor(board, color, level);
  if (!candidates.length) return -1;
  if (level === 1) return candidates[Math.floor(Math.random() * Math.min(3, candidates.length))].i;
  if (level === 2 || candidates[0].score >= 1000000) return candidates[0].i;
  let best = -Infinity, choice = candidates[0].i;
  for (const candidate of candidates.slice(0, 8)) {
    const next = board.slice(); next[candidate.i] = color;
    const reply = candidatesFor(next, 3 - color, 2)[0];
    const score = candidate.score - (reply?.score || 0) * 0.7;
    if (score > best) { best = score; choice = candidate.i; }
  }
  return choice;
}
