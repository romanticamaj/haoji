import { mmss, nameOf, mergedParagraphs } from '../transcript';

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
  expect(p[0]).toMatchObject({ speaker: 'A', start: 0, text: '你好今天開會' });
  expect(p[1]).toMatchObject({ speaker: 'B', text: '好' });
});
