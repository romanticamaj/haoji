import { speakersByFirstAppearance } from '../transcript';
import { avatarSpec, STACK_MAX } from '../sessionList';
import { SavedSession } from '../store';

// Issue #32 item 5: the avatar stacks on Home and Results list speakers in the order they first
// speak, show STACK_MAX (3) faces, then +N. Each face keeps its speaker-list index, so its colour and
// number match the transcript turns below.
const seg = (speaker: string, start: number) => ({ start, end: start + 1, speaker, text: 'x' });

describe('speakersByFirstAppearance', () => {
  test('orders by first segment, keeping each speaker\'s list index', () => {
    const segs = [seg('S2', 0), seg('S0', 1), seg('S2', 2), seg('S1', 3)];
    expect(speakersByFirstAppearance(segs, ['S0', 'S1', 'S2'])).toEqual([
      { speaker: 'S2', index: 2 }, { speaker: 'S0', index: 0 }, { speaker: 'S1', index: 1 },
    ]);
  });

  test('a listed speaker who never speaks comes last, in list order', () => {
    expect(speakersByFirstAppearance([seg('S1', 0)], ['S0', 'S1', 'S2'])).toEqual([
      { speaker: 'S1', index: 1 }, { speaker: 'S0', index: 0 }, { speaker: 'S2', index: 2 },
    ]);
  });

  test('a speaker missing from the list takes the first colour, like the transcript turns', () => {
    expect(speakersByFirstAppearance([seg('X', 0), seg('S0', 1)], ['S0'])).toEqual([
      { speaker: 'X', index: 0 }, { speaker: 'S0', index: 0 },
    ]);
  });

  test('nothing in, nothing out', () => {
    expect(speakersByFirstAppearance([], [])).toEqual([]);
  });
});

describe('avatarSpec follows first appearance', () => {
  test('STACK_MAX is 3', () => {
    expect(STACK_MAX).toBe(3);
  });

  test('the first speaker to talk is the first face, numbered and coloured by speaker index', () => {
    const s: SavedSession = {
      id: 'x', createdAt: 1, title: 't', unlocked: false, parts: [],
      names: { S1: '建宏' },
      transcript: { speakers: ['S0', 'S1', 'S2', 'S3'], segments: [seg('S3', 0), seg('S1', 1), seg('S0', 2)] },
    };
    expect(avatarSpec(s)).toEqual({ initials: ['4', '建', '1'], colorIndex: [3, 1, 0], overflow: 1 });
  });
});
