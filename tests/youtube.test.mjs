import test from 'node:test';
import assert from 'node:assert/strict';
import { extractInitialData, parseResults } from '../youtube.mjs';

const sample = {
  contents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [
    { videoRenderer: { videoId: 'abc123', title: { runs: [{ text: '첫 영상' }] }, ownerText: { runs: [{ text: '채널' }] },
      lengthText: { simpleText: '3:21' }, shortViewCountText: { simpleText: '조회수 1만회' }, publishedTimeText: { simpleText: '1일 전' } } },
    { adSlotRenderer: {} },
    { videoRenderer: { videoId: 'live99', title: { runs: [{ text: '라이브' }] }, ownerText: { runs: [{ text: 'TV' }] }, badges: [{}] } },
    { videoRenderer: { videoId: 'abc123', title: { runs: [{ text: '중복' }] } } },
  ] } }] } },
};

test('extractInitialData reads the embedded JSON', () => {
  const html = `<script>var ytInitialData = ${JSON.stringify(sample)};</script><script>x()</script>`;
  assert.deepEqual(extractInitialData(html), sample);
  assert.equal(extractInitialData('<html>no data</html>'), null);
  assert.equal(extractInitialData('var ytInitialData = {broken;</script>'), null);
});

test('parseResults returns unique videos in order with display fields', () => {
  const videos = parseResults(sample);
  assert.deepEqual(videos.map((v) => v.id), ['abc123', 'live99']);
  assert.equal(videos[0].title, '첫 영상');
  assert.equal(videos[0].length, '3:21');
  assert.equal(videos[0].views, '조회수 1만회');
  assert.equal(videos[1].live, true);
});
