import { speakerStats } from '../transcript';
import { Segment } from '../types';

const seg = (speaker: string, start: number, end: number): Segment =>
  ({ speaker, start, end, text: 'x' });

test('ranks speakers by how long they spoke, not by transcript order', () => {
  const stats = speakerStats(
    [seg('SPEAKER_00', 0, 2), seg('SPEAKER_01', 2, 20), seg('SPEAKER_02', 20, 25)],
    ['SPEAKER_00', 'SPEAKER_01', 'SPEAKER_02'],
  );
  expect(stats.map((s) => s.speaker)).toEqual(['SPEAKER_01', 'SPEAKER_02', 'SPEAKER_00']);
  expect(stats[0].ms).toBe(18_000);
});

test('consecutive segments by one speaker count as a single turn', () => {
  const stats = speakerStats(
    [seg('A', 0, 1), seg('A', 1, 2), seg('B', 2, 3), seg('A', 3, 4)],
    ['A', 'B'],
  );
  expect(stats.find((s) => s.speaker === 'A')!.turns).toBe(2);   // A speaks, B interjects, A resumes
  expect(stats.find((s) => s.speaker === 'B')!.turns).toBe(1);
});

// Dropping them would read as the app having lost a speaker the transcript claims exists.
test('a listed speaker with no segments is still listed, at zero', () => {
  const stats = speakerStats([seg('A', 0, 5)], ['A', 'B']);
  expect(stats.map((s) => s.speaker)).toEqual(['A', 'B']);
  expect(stats[1]).toMatchObject({ ms: 0, turns: 0 });
});

test('a speaker appearing only in segments is kept', () => {
  const stats = speakerStats([seg('GHOST', 0, 3)], []);
  expect(stats).toHaveLength(1);
  expect(stats[0].speaker).toBe('GHOST');
});

test('the colour index follows the transcript speaker list, not the sorted order', () => {
  const stats = speakerStats([seg('A', 0, 1), seg('B', 1, 30)], ['A', 'B']);
  expect(stats[0]).toMatchObject({ speaker: 'B', index: 1 });   // top of the list, still colour #2
});

test('no segments and no speakers is an empty list, not a crash', () => {
  expect(speakerStats([], [])).toEqual([]);
});
