export const TOWERS = {
  arrow: { name: '화살', cost: 55, range: 2.5, damage: 12, rate: 0.55, antiAir: true, color: '#55b98c' },
  cannon: { name: '대포', cost: 90, range: 2.2, damage: 28, rate: 1.2, splash: 1, color: '#eea65b' },
  frost: { name: '서리', cost: 75, range: 2.1, damage: 7, rate: 0.8, slow: true, antiAir: true, color: '#73d8ee' },
  lightning: { name: '번개', cost: 100, range: 2.4, damage: 15, rate: 0.9, chain: true, antiAir: true, color: '#c8a4ff' },
  sniper: { name: '저격', cost: 120, range: 4, damage: 42, rate: 1.8, pierce: true, antiAir: true, color: '#ef8fab' }
};
export const ENEMIES = {
  basic: { name: '길잡이', hp: 35, speed: 0.85, reward: 8, color: '#f28f80' },
  fast: { name: '질주꾼', hp: 25, speed: 1.5, reward: 9, color: '#ffd36d' },
  armored: { name: '갑옷', hp: 65, speed: 0.65, armor: 7, reward: 13, color: '#a7a9c9' },
  flying: { name: '날개', hp: 38, speed: 1.1, flying: true, reward: 12, color: '#b4a6ff' },
  healer: { name: '치유사', hp: 65, speed: 0.7, reward: 15, color: '#8fe2ba' },
  splitter: { name: '분열체', hp: 70, speed: 0.8, reward: 14, color: '#f7a2d4' },
  boss: { name: '거대 수호파괴자', hp: 600, speed: 0.45, armor: 5, reward: 90, color: '#db6d8b' }
};
export function chooseTarget(tower, enemies, mode = 'first') {
  const eligible = enemies.filter(e => e.hp > 0 && (!e.flying || tower.antiAir) && Math.hypot(e.x - tower.x, e.y - tower.y) <= tower.range);
  const distance = e => Math.hypot(e.x - tower.x, e.y - tower.y);
  eligible.sort((a, b) => mode === 'last' ? a.progress - b.progress : mode === 'strongest' ? b.hp - a.hp : mode === 'closest' ? distance(a) - distance(b) : b.progress - a.progress);
  return eligible[0];
}
export function damageEnemy(enemy, damage, pierce = false) {
  return Math.max(0, enemy.hp - Math.max(1, damage - (pierce ? 0 : (enemy.armor || 0))));
}
export function wavePlan(wave) {
  const types = ['basic', 'fast', 'armored', 'flying', 'healer', 'splitter'];
  const unlocked = Math.min(types.length, 1 + Math.floor(wave / 3));
  const count = 5 + wave * 2;
  const plan = Array.from({ length: count }, (_, i) => ({ time: i * Math.max(0.35, 0.85 - wave * 0.015), type: types[(i + wave) % unlocked] }));
  if (wave % 5 === 0) plan.push({ time: count * 0.6 + 1, type: 'boss' });
  return plan.sort((a, b) => a.time - b.time);
}
