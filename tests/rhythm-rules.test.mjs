import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, chart, songs } from '../public/apps/rhythm/rules.js';

test('judgement windows include their boundaries', () => {
  assert.equal(judge(0.045), '완벽');
  assert.equal(judge(0.09), '좋음');
  assert.equal(judge(0.15), '아쉬움');
  assert.equal(judge(0.151), '놓침');
});

test('charts derive times and lanes from song events', () => {
  assert.equal(songs.length, 3);
  for (const song of songs) {
    const easy = chart(song, 'easy');
    const hard = chart(song, 'hard');
    assert.ok(easy.length > 0 && hard.length > easy.length);
    assert.ok(hard.every(note => note.time === note.beat * 60 / song.bpm && note.lane >= 0 && note.lane < 4));
  }
});
