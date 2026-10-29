export function judge(offset) {
  const distance = Math.abs(offset);
  return distance <= 0.045 ? '완벽' : distance <= 0.09 ? '좋음' : distance <= 0.15 ? '아쉬움' : '놓침';
}

const melodies = [
  [60, 64, 67, 72, 67, 64, 62, 65, 69, 74, 69, 65, 64, 67, 71, 76],
  [57, 60, 64, 69, 72, 69, 64, 60, 55, 59, 62, 67, 71, 67, 62, 59],
  [62, 65, 69, 74, 72, 69, 65, 62, 60, 64, 67, 72, 71, 67, 64, 60]
];
export const songs = [
  { name: '새벽 산책', bpm: 100, melody: melodies[0], bass: [36, 41, 43, 36] },
  { name: '유리 구름', bpm: 122, melody: melodies[1], bass: [33, 38, 35, 40] },
  { name: '파란 궤도', bpm: 145, melody: melodies[2], bass: [38, 43, 36, 41] }
];

export function events(song) {
  const result = [];
  for (let beat = 0; beat < 32; beat += 0.5) {
    result.push({ beat, type: 'lead', pitch: song.melody[(beat * 2) % song.melody.length], lane: (beat * 2) % 4 });
    if (beat % 2 === 0) result.push({ beat, type: 'bass', pitch: song.bass[Math.floor(beat / 8) % 4] });
    if (beat % 1 === 0) result.push({ beat, type: 'drum', pitch: beat % 2 === 0 ? 100 : 180 });
  }
  return result;
}

export function chart(song, difficulty) {
  return events(song).filter(event => event.type === 'lead' && (difficulty === 'hard' || event.beat % 1 === 0))
    .map(event => ({ ...event, time: event.beat * 60 / song.bpm }));
}
