import { mmss, nameOf, mergedParagraphs, applyTurnEdit, activeParagraph, transcriptPlainText } from '../transcript';

describe('transcriptPlainText', () => {
  const segs = [
    { start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好' },
    { start: 2, end: 4, speaker: 'SPEAKER_00', text: '今天開會' },
    { start: 65, end: 68, speaker: 'SPEAKER_01', text: '好' },
  ];
  test('merges same-speaker turns and labels each with [mm:ss] + resolved name', () => {
    expect(transcriptPlainText(segs, { SPEAKER_00: 'Gary' })).toBe(
      '[00:00] Gary\n你好今天開會\n\n[01:05] SPEAKER_01\n好',
    );
  });
  test('empty transcript → empty string', () => {
    expect(transcriptPlainText([], {})).toBe('');
  });
});

describe('activeParagraph', () => {
  const starts = [0, 4, 10]; // paragraph start times in seconds
  test('returns -1 before playback (ms<=0)', () => {
    expect(activeParagraph(starts, 0)).toBe(-1);
    expect(activeParagraph(starts, -5)).toBe(-1);
  });
  test('picks the last paragraph whose start is at or before the playhead', () => {
    expect(activeParagraph(starts, 500)).toBe(0);    // 0.5s → paragraph 0
    expect(activeParagraph(starts, 4000)).toBe(1);   // exactly 4s → paragraph 1
    expect(activeParagraph(starts, 9000)).toBe(1);   // 9s → still paragraph 1
    expect(activeParagraph(starts, 12000)).toBe(2);  // 12s → paragraph 2
  });
});

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
