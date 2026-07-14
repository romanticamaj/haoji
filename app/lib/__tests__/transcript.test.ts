import { mmss, nameOf, mergedParagraphs, applyTurnEdit } from '../transcript';

test('mmss formats seconds', () => {
  expect(mmss(0)).toBe('00:00');
  expect(mmss(75)).toBe('01:15');
});

test('nameOf falls back to the raw speaker label', () => {
  expect(nameOf('SPEAKER_00', { SPEAKER_00: 'Gary' })).toBe('Gary');
  expect(nameOf('SPEAKER_01', {})).toBe('SPEAKER_01');
});

test('mergedParagraphs merges consecutive same-speaker segments', () => {
  const segs = [
    { start: 0, end: 2, speaker: 'A', text: '你好' },
    { start: 2, end: 4, speaker: 'A', text: '今天開會' },
    { start: 4, end: 6, speaker: 'B', text: '好' },
  ];
  const p = mergedParagraphs(segs);
  expect(p.length).toBe(2);
  // the first paragraph spans segments 0..1, the second is segment 2 only
  expect(p[0]).toMatchObject({ speaker: 'A', start: 0, text: '你好今天開會', startIdx: 0, endIdx: 1 });
  expect(p[1]).toMatchObject({ speaker: 'B', text: '好', startIdx: 2, endIdx: 2 });
});

test('applyTurnEdit collapses a paragraph range into one corrected segment, keeping start/end/speaker', () => {
  const segs = [
    { start: 0, end: 2, speaker: 'A', text: '你好' },
    { start: 2, end: 4, speaker: 'A', text: '今天開會' },
    { start: 4, end: 6, speaker: 'B', text: '好' },
  ];
  const out = applyTurnEdit(segs, 0, 1, '你好，今天開會');
  expect(out).toEqual([
    { start: 0, end: 4, speaker: 'A', text: '你好，今天開會' }, // spans 0..1, boundaries preserved
    { start: 4, end: 6, speaker: 'B', text: '好' },
  ]);
});

test('applyTurnEdit edits a single-segment paragraph in place', () => {
  const segs = [{ start: 4, end: 6, speaker: 'B', text: '好' }];
  expect(applyTurnEdit(segs, 0, 0, '好的')).toEqual([{ start: 4, end: 6, speaker: 'B', text: '好的' }]);
});

test('applyTurnEdit returns the input unchanged when the range is out of bounds', () => {
  const segs = [{ start: 0, end: 2, speaker: 'A', text: '你好' }];
  expect(applyTurnEdit(segs, 5, 9, 'x')).toBe(segs);
});
