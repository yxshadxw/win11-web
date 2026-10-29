const levels = { easy: 42, medium: 35, hard: 30, expert: 26 };

function candidates(board, index) {
  const row = Math.floor(index / 9), col = index % 9;
  const used = new Set();
  for (let i = 0; i < 9; i++) {
    used.add(board[row * 9 + i]);
    used.add(board[i * 9 + col]);
    used.add(board[(Math.floor(row / 3) * 3 + Math.floor(i / 3)) * 9 + Math.floor(col / 3) * 3 + i % 3]);
  }
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(n => !used.has(n));
}

export function solve(input, random = false) {
  const board = input.slice();
  let count = 0, solution = null;
  for (let i = 0; i < 81; i++) {
    if (board[i]) {
      const n = board[i]; board[i] = 0;
      if (!candidates(board, i).includes(n)) return { count: 0, solution: null };
      board[i] = n;
    }
  }
  function search() {
    if (count >= 2) return;
    let target = -1, options = null;
    for (let i = 0; i < 81; i++) if (!board[i]) {
      const list = candidates(board, i);
      if (!options || list.length < options.length) { target = i; options = list; }
      if (!list.length) return;
    }
    if (target < 0) { count++; solution ||= board.slice(); return; }
    if (random) options.sort(() => Math.random() - 0.5);
    for (const n of options) { board[target] = n; search(); board[target] = 0; if (count >= 2) break; }
  }
  search();
  return { count, solution };
}

export function generate(difficulty = 'easy') {
  const solution = solve(Array(81).fill(0), true).solution;
  const puzzle = solution.slice();
  const order = Array.from({ length: 81 }, (_, i) => i).sort(() => Math.random() - 0.5);
  let remaining = 81;
  for (const i of order) {
    if (remaining <= (levels[difficulty] || 42)) break;
    const old = puzzle[i]; puzzle[i] = 0;
    if (solve(puzzle).count !== 1) puzzle[i] = old;
    else remaining--;
  }
  return { puzzle, solution };
}
