const files = 'abcdefgh';
const sideOf = piece => piece && (piece === piece.toUpperCase() ? 'w' : 'b');
const other = side => side === 'w' ? 'b' : 'w';
const inside = (x, y) => x >= 0 && x < 8 && y >= 0 && y < 8;
const square = name => name === '-' ? -1 : (8 - Number(name[1])) * 8 + files.indexOf(name[0]);
export const nameOf = i => files[i % 8] + (8 - Math.floor(i / 8));

export function fromFEN(fen) {
  const [placement, turn, castling, ep, half, full] = fen.split(' ');
  const board = [];
  for (const c of placement) {
    if (c === '/') continue;
    if (/\d/.test(c)) board.push(...Array(Number(c)).fill(null));
    else board.push(c);
  }
  const state = { board, turn, castling: castling === '-' ? '' : castling, ep: square(ep), half: Number(half), full: Number(full), history: [] };
  state.history = [positionKey(state)];
  return state;
}
export const initial = () => fromFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

export function attacked(board, target, by) {
  const tx = target % 8, ty = Math.floor(target / 8);
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (sideOf(p) !== by) continue;
    const x = i % 8, y = Math.floor(i / 8), dx = tx - x, dy = ty - y, type = p.toLowerCase();
    if (type === 'p' && Math.abs(dx) === 1 && dy === (by === 'w' ? -1 : 1)) return true;
    if (type === 'n' && Math.abs(dx) * Math.abs(dy) === 2) return true;
    if (type === 'k' && Math.max(Math.abs(dx), Math.abs(dy)) === 1) return true;
    if (!dx && !dy) continue;
    if ((type === 'r' || type === 'q') && (dx === 0 || dy === 0) || (type === 'b' || type === 'q') && Math.abs(dx) === Math.abs(dy)) {
      const sx = Math.sign(dx), sy = Math.sign(dy);
      let cx = x + sx, cy = y + sy, clear = true;
      while (cx !== tx || cy !== ty) { if (board[cy * 8 + cx]) { clear = false; break; } cx += sx; cy += sy; }
      if (clear) return true;
    }
  }
  return false;
}
export function inCheck(state, side = state.turn) {
  return attacked(state.board, state.board.indexOf(side === 'w' ? 'K' : 'k'), other(side));
}
function pseudo(state) {
  const { board, turn } = state, moves = [];
  const add = (from, to, extra = {}) => {
    if (board[to]?.toLowerCase() === 'k') return;
    if (board[from].toLowerCase() === 'p' && (to < 8 || to >= 56)) {
      for (const promotion of ['q', 'r', 'b', 'n']) moves.push({ from, to, promotion, ...extra });
    } else moves.push({ from, to, ...extra });
  };
  for (let i = 0; i < 64; i++) {
    const p = board[i]; if (sideOf(p) !== turn) continue;
    const x = i % 8, y = Math.floor(i / 8), type = p.toLowerCase();
    if (type === 'p') {
      const d = turn === 'w' ? -1 : 1, ny = y + d;
      if (inside(x, ny) && !board[ny * 8 + x]) {
        add(i, ny * 8 + x);
        if (y === (turn === 'w' ? 6 : 1) && !board[(y + 2 * d) * 8 + x]) add(i, (y + 2 * d) * 8 + x);
      }
      for (const nx of [x - 1, x + 1]) if (inside(nx, ny)) {
        const to = ny * 8 + nx;
        if (board[to] && sideOf(board[to]) !== turn) add(i, to);
        else if (to === state.ep && board[y * 8 + nx]?.toLowerCase() === 'p' && sideOf(board[y * 8 + nx]) === other(turn)) add(i, to, { ep: true });
      }
      continue;
    }
    const dirs = type === 'n' ? [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]] :
      [...(type !== 'b' ? [[1,0],[-1,0],[0,1],[0,-1]] : []), ...(type !== 'r' ? [[1,1],[-1,1],[1,-1],[-1,-1]] : [])];
    for (const [dx, dy] of dirs) {
      let nx = x + dx, ny = y + dy;
      while (inside(nx, ny)) {
        const to = ny * 8 + nx;
        if (sideOf(board[to]) === turn) break;
        add(i, to);
        if (board[to] || type === 'n' || type === 'k') break;
        nx += dx; ny += dy;
      }
    }
    if (type === 'k' && i === (turn === 'w' ? 60 : 4) && !inCheck(state)) {
      for (const [right, rook, empty, safe, to] of turn === 'w' ? [['K',63,[61,62],[61,62],62],['Q',56,[59,58,57],[59,58],58]] : [['k',7,[5,6],[5,6],6],['q',0,[3,2,1],[3,2],2]]) {
        if (state.castling.includes(right) && board[rook] === (turn === 'w' ? 'R' : 'r') && empty.every(n => !board[n]) && safe.every(n => !attacked(board, n, other(turn)))) add(i, to, { castle: right });
      }
    }
  }
  return moves;
}
export function play(state, move) {
  const board = state.board.slice(), piece = board[move.from], captured = board[move.to];
  board[move.from] = null; board[move.to] = move.promotion ? (state.turn === 'w' ? move.promotion.toUpperCase() : move.promotion) : piece;
  if (move.ep) board[move.to + (state.turn === 'w' ? 8 : -8)] = null;
  if (move.castle) {
    const kingSide = move.castle.toLowerCase() === 'k', rookFrom = Math.floor(move.from / 8) * 8 + (kingSide ? 7 : 0), rookTo = move.to + (kingSide ? -1 : 1);
    board[rookTo] = board[rookFrom]; board[rookFrom] = null;
  }
  let castling = state.castling;
  if (piece === 'K') castling = castling.replace(/[KQ]/g, '');
  if (piece === 'k') castling = castling.replace(/[kq]/g, '');
  for (const [i, right] of [[63,'K'],[56,'Q'],[7,'k'],[0,'q']]) if (move.from === i || move.to === i) castling = castling.replace(right, '');
  const next = { board, turn: other(state.turn), castling, ep: piece.toLowerCase() === 'p' && Math.abs(move.to - move.from) === 16 ? (move.to + move.from) / 2 : -1, half: piece.toLowerCase() === 'p' || captured || move.ep ? 0 : state.half + 1, full: state.full + (state.turn === 'b' ? 1 : 0), history: state.history.slice() };
  next.history.push(positionKey(next)); return next;
}
export function legalMoves(state) {
  return pseudo(state).filter(move => !inCheck(play(state, move), state.turn));
}
function positionKey(state) {
  // En passant only changes the position when a legal capture is available.
  let ep = '-';
  if (state.ep >= 0) {
    const y = Math.floor(state.ep / 8) + (state.turn === 'w' ? 1 : -1), x = state.ep % 8;
    for (const nx of [x - 1, x + 1]) if (inside(nx, y) && state.board[y * 8 + nx] === (state.turn === 'w' ? 'P' : 'p')) {
      const board = state.board.slice(), from = y * 8 + nx;
      board[state.ep] = board[from]; board[from] = null; board[y * 8 + x] = null;
      if (!attacked(board, board.indexOf(state.turn === 'w' ? 'K' : 'k'), other(state.turn))) ep = nameOf(state.ep);
    }
  }
  return state.board.map(p => p || '.').join('') + state.turn + state.castling + ep;
}
export function status(state) {
  const moves = legalMoves(state), check = inCheck(state);
  if (!moves.length) return { kind: check ? 'checkmate' : 'stalemate', check };
  if (state.half >= 100) return { kind: 'fifty', check };
  if (state.history.filter(key => key === positionKey(state)).length >= 3) return { kind: 'repetition', check };
  const pieces = state.board.map((p, i) => p && ({ p: p.toLowerCase(), i })).filter(Boolean).filter(v => v.p !== 'k');
  if (!pieces.length || pieces.length === 1 && ['b','n'].includes(pieces[0].p) || pieces.length && pieces.every(v => v.p === 'b') && new Set(pieces.map(v => (v.i % 8 + Math.floor(v.i / 8)) % 2)).size === 1) return { kind: 'material', check };
  return { kind: 'playing', check };
}
export function notation(state, move) {
  const piece = state.board[move.from].toLowerCase();
  if (move.castle) {
    const result = status(play(state, move));
    return (move.to % 8 === 6 ? 'O-O' : 'O-O-O') + (result.kind === 'checkmate' ? '#' : result.check ? '+' : '');
  }
  const capture = state.board[move.to] || move.ep;
  let disambiguation = '';
  if (piece !== 'p') {
    const rivals = legalMoves(state).filter(m => m.to === move.to && m.from !== move.from && state.board[m.from].toLowerCase() === piece);
    if (rivals.length) disambiguation = rivals.every(m => m.from % 8 !== move.from % 8) ? files[move.from % 8] : rivals.every(m => Math.floor(m.from / 8) !== Math.floor(move.from / 8)) ? String(8 - Math.floor(move.from / 8)) : nameOf(move.from);
  }
  const next = play(state, move), result = status(next);
  return (piece === 'p' ? (capture ? files[move.from % 8] : '') : piece.toUpperCase() + disambiguation) + (capture ? 'x' : '') + nameOf(move.to) + (move.promotion ? '=' + move.promotion.toUpperCase() : '') + (result.kind === 'checkmate' ? '#' : result.check ? '+' : '');
}
