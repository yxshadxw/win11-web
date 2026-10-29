import { legalMoves, play, inCheck } from './rules.js';
const value = { p:100, n:320, b:330, r:500, q:900, k:0 };
// Central control and pawn advancement form compact piece-square tables.
const tables = Object.fromEntries(Object.keys(value).map(type => [type, Array.from({ length:64 }, (_, i) => {
  const x = i % 8, y = Math.floor(i / 8), center = 7 - Math.abs(x * 2 - 7) - Math.abs(y * 2 - 7);
  return type === 'p' ? (6 - y) * 7 + center : type === 'n' || type === 'b' ? center * 5 : type === 'k' ? -center * 2 : center;
})]));
function evaluate(state) {
  return state.board.reduce((sum, p, i) => {
    if (!p) return sum;
    const white = p === p.toUpperCase(), type = p.toLowerCase();
    return sum + (white ? 1 : -1) * (value[type] + tables[type][white ? i : 63 - i]);
  }, 0) * (state.turn === 'w' ? 1 : -1);
}
function search(state, depth, alpha, beta) {
  if (!depth) return evaluate(state);
  const moves = legalMoves(state);
  if (!moves.length) return inCheck(state) ? -100000 - depth : 0;
  moves.sort((a, b) => Number(Boolean(state.board[b.to])) - Number(Boolean(state.board[a.to])));
  let best = -Infinity;
  for (const move of moves) {
    const score = -search(play(state, move), depth - 1, -beta, -alpha);
    best = Math.max(best, score); alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
  }
  return best;
}
self.onmessage = ({ data }) => {
  const { state, depth } = data; let best = -Infinity, selected = null, alpha = -Infinity;
  for (const move of legalMoves(state)) {
    const score = -search(play(state, move), depth - 1, -Infinity, -alpha);
    if (score > best) { best = score; selected = move; }
    alpha = Math.max(alpha, score);
  }
  self.postMessage(selected);
};
