export const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
const red = card => card.suit === 'hearts' || card.suit === 'diamonds';
export function canTableau(card, top) {
  return !!card && card.faceUp && (top ? top.faceUp && red(card) !== red(top) && card.rank === top.rank - 1 : card.rank === 13);
}
export function canFoundation(card, top) {
  return !!card && card.faceUp && (top ? card.suit === top.suit && card.rank === top.rank + 1 : card.rank === 1);
}
export function isWon(game) {
  return game.foundations.every(pile => pile.length === 13);
}
export function newGame(random = Math.random) {
  const deck = suits.flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ suit, rank: i + 1, faceUp: false })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const tableau = Array.from({ length: 7 }, (_, i) => {
    const pile = deck.splice(0, i + 1);
    pile.at(-1).faceUp = true;
    return pile;
  });
  return { stock: deck, waste: [], tableau, foundations: [[], [], [], []], score: 0, moves: 0 };
}
export function draw(game, count) {
  if (!game.stock.length && !game.waste.length) return false;
  if (!game.stock.length) {
    game.stock = game.waste.reverse();
    game.stock.forEach(card => { card.faceUp = false; });
    game.waste = [];
  } else {
    for (let i = 0; i < count && game.stock.length; i++) {
      const card = game.stock.pop();
      card.faceUp = true;
      game.waste.push(card);
    }
  }
  game.moves++;
  return true;
}
export function move(game, source, target) {
  const from = source.type === 'waste' ? game.waste : game[source.type][source.index];
  const to = game[target.type][target.index];
  if (!from || !to || from === to || !from.length) return false;
  const index = source.type === 'tableau' ? source.card : from.length - 1;
  const moving = from.slice(index);
  if (!moving.length || !moving[0].faceUp) return false;
  if (target.type === 'foundations' && (moving.length !== 1 || !canFoundation(moving[0], to.at(-1)))) return false;
  if (target.type === 'tableau' && !canTableau(moving[0], to.at(-1))) return false;
  to.push(...from.splice(index));
  game.score = Math.max(0, (game.score || 0) + (target.type === 'foundations' ? 10 : source.type === 'foundations' ? -10 : source.type === 'waste' ? 5 : 0));
  if (source.type === 'tableau' && from.length && !from.at(-1).faceUp) {
    from.at(-1).faceUp = true;
    game.score += 5;
  }
  game.moves = (game.moves || 0) + 1;
  return true;
}
export function findMoves(game) {
  const sources = [];
  if (game.waste.length) sources.push({ type: 'waste' });
  game.tableau.forEach((pile, index) => pile.forEach((card, n) => {
    if (card.faceUp) sources.push({ type: 'tableau', index, card: n });
  }));
  game.foundations.forEach((pile, index) => { if (pile.length) sources.push({ type: 'foundations', index }); });
  const found = [];
  for (const source of sources) {
    const from = source.type === 'waste' ? game.waste : game[source.type][source.index];
    const index = source.type === 'tableau' ? source.card : from.length - 1;
    const card = from[index];
    if (source.type !== 'foundations' && index === from.length - 1) {
      game.foundations.forEach((pile, i) => { if (canFoundation(card, pile.at(-1))) found.push({ source, target: { type: 'foundations', index: i } }); });
    }
    game.tableau.forEach((pile, i) => {
      if (source.type === 'tableau' && (source.index === i || (!pile.length && index === 0))) return;
      if (canTableau(card, pile.at(-1))) found.push({ source, target: { type: 'tableau', index: i } });
    });
  }
  return found;
}
