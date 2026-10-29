import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { sanitizeHTML, sortNotes } from '../public/apps/sticky/rules.js';

test('sanitizer retains permitted markup but strips attributes and dangerous content', () => {
  assert.equal(sanitizeHTML('<div onclick="x"><b>안녕</b><script>alert(1)</script><img src=x><i>메모</i></div>'), '<div><b>안녕</b><i>메모</i></div>');
});
test('notes sort by latest modification without mutating source', () => {
  const notes = [{ modified: 1 }, { modified: 3 }];
  assert.deepEqual(sortNotes(notes).map(note => note.modified), [3, 1]);
  assert.equal(notes[0].modified, 1);
});
