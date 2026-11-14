import {
  relativeDay, groupSessions, totalDurationMs, durationLabel, speakerCount,
  hasTranscript, hasNotes, avatarSpec, inlineStatus,
} from '../sessionList';
import { SavedSession } from '../store';
import { Transcript } from '../types';

// Fixed "now": Wed 2026-07-08 15:00 local.
const NOW = new Date(2026, 6, 8, 15, 0, 0).getTime();
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m, d, h, min).getTime();

const mk = (over: Partial<SavedSession> = {}): SavedSession => ({
  id: 'x', createdAt: NOW, title: 't', names: {}, unlocked: false, parts: [], ...over,
});

const transcript = (speakers: string[], segCount = 1): Transcript => ({
  speakers,
  segments: Array.from({ length: segCount }, (_, i) => ({ start: i, end: i + 1, speaker: speakers[0] ?? 'S0', text: 'hi' })),
});

describe('relativeDay', () => {
  test('today shows 今天 HH:mm', () => {
    expect(relativeDay(at(2026, 6, 8, 14, 30), NOW)).toBe('今天 14:30');
  });
  test('later-today (after now) still counts as 今天', () => {
    expect(relativeDay(at(2026, 6, 8, 23, 5), NOW)).toBe('今天 23:05');
  });
  test('yesterday shows 昨天 HH:mm', () => {
    expect(relativeDay(at(2026, 6, 7, 9, 12), NOW)).toBe('昨天 09:12');
  });
  test('yesterday boundary is by calendar day, not 24h', () => {
    // 2 min before now-1day would be same 24h window but is calendar yesterday.
    expect(relativeDay(at(2026, 6, 7, 23, 59), NOW)).toBe('昨天 23:59');
  });
  test('earlier this week shows weekday HH:mm', () => {
    // Mon 2026-07-06 → 週一
    expect(relativeDay(at(2026, 6, 6, 16, 20), NOW)).toBe('週一 16:20');
  });
  test('6 days ago still weekday (this-week window)', () => {
    // Thu 2026-07-02 is 6 days before Wed 2026-07-08 → 週四
    expect(relativeDay(at(2026, 6, 2, 8, 5), NOW)).toBe('週四 08:05');
  });
  test('7+ days ago shows M/D', () => {
    expect(relativeDay(at(2026, 5, 28, 10, 0), NOW)).toBe('6/28');
  });
});

describe('groupSessions', () => {
  test('buckets today / this-week / older and drops empty groups', () => {
    const today = mk({ id: 'today', createdAt: at(2026, 6, 8, 10) });
    const week = mk({ id: 'week', createdAt: at(2026, 6, 6, 10) });
    const older = mk({ id: 'older', createdAt: at(2026, 5, 20, 10) });
    const groups = groupSessions([today, week, older], NOW);
    expect(groups.map((g) => g.key)).toEqual(['今天', '本週', '更早']);
    expect(groups[0].items.map((s) => s.id)).toEqual(['today']);
    expect(groups[1].items.map((s) => s.id)).toEqual(['week']);
    expect(groups[2].items.map((s) => s.id)).toEqual(['older']);
  });
  test('drops groups with no items', () => {
    const groups = groupSessions([mk({ createdAt: at(2026, 6, 8, 10) })], NOW);
    expect(groups.map((g) => g.key)).toEqual(['今天']);
  });
  test('preserves newest-first order within a group', () => {
    const a = mk({ id: 'a', createdAt: at(2026, 6, 8, 14) });
    const b = mk({ id: 'b', createdAt: at(2026, 6, 8, 9) });
    const groups = groupSessions([a, b], NOW);
    expect(groups[0].items.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('duration', () => {
  test('sums part durations', () => {
    const s = mk({ parts: [{ uri: 'a', durationMs: 60000 }, { uri: 'b', durationMs: 5000 }] });
    expect(totalDurationMs(s)).toBe(65000);
    expect(durationLabel(s)).toBe('01:05');
  });
  test('durationLabel is null when total is 0', () => {
    const s = mk({ parts: [{ uri: 'a', durationMs: 0 }] });
    expect(totalDurationMs(s)).toBe(0);
    expect(durationLabel(s)).toBeNull();
  });
  test('no parts → 0 / null', () => {
    expect(totalDurationMs(mk())).toBe(0);
    expect(durationLabel(mk())).toBeNull();
  });
});

describe('status derivation', () => {
  test('hasTranscript true only with segments', () => {
    expect(hasTranscript(mk())).toBe(false);
    expect(hasTranscript(mk({ transcript: transcript(['S0'], 0) }))).toBe(false);
    expect(hasTranscript(mk({ transcript: transcript(['S0'], 2) }))).toBe(true);
  });
  test('hasNotes true only with non-empty notes', () => {
    expect(hasNotes(mk())).toBe(false);
    expect(hasNotes(mk({ notes: '   ' }))).toBe(false);
    expect(hasNotes(mk({ notes: '## 摘要' }))).toBe(true);
  });
  test('speakerCount from transcript', () => {
    expect(speakerCount(mk())).toBe(0);
    expect(speakerCount(mk({ transcript: transcript(['S0', 'S1', 'S2', 'S3']) }))).toBe(4);
  });
});

describe('avatarSpec', () => {
  test('no transcript → no avatars', () => {
    expect(avatarSpec(mk())).toMatchObject({ initials: [], overflow: 0 });
  });
  test('uses index number when unnamed', () => {
    const s = mk({ transcript: transcript(['S0', 'S1']) });
    expect(avatarSpec(s)).toMatchObject({ initials: ['1', '2'], overflow: 0 });
  });
  test('uses first char of mapped name when named', () => {
    const s = mk({ transcript: transcript(['S0', 'S1']), names: { S0: '郁婷', S1: '建宏' } });
    expect(avatarSpec(s)).toMatchObject({ initials: ['郁', '建'], overflow: 0 });
  });
  test('caps at 3 and reports overflow', () => {
    const s = mk({ transcript: transcript(['S0', 'S1', 'S2', 'S3', 'S4']) });
    expect(avatarSpec(s)).toMatchObject({ initials: ['1', '2', '3'], overflow: 2 });
  });
  test('exactly 3 speakers → no overflow', () => {
    const s = mk({ transcript: transcript(['S0', 'S1', 'S2']) });
    expect(avatarSpec(s)).toMatchObject({ initials: ['1', '2', '3'], overflow: 0 });
  });
});

describe('inlineStatus (the word at the end of a card meta line)', () => {
  const job = (stage: string) => ({ stage, uploaded: 0, pct: 0, message: '', updatedAt: 0 }) as any;
  test('an upload or transcription in flight → 處理中', () => {
    expect(inlineStatus(mk({ job: job('uploading') }))).toBe('處理中');
    expect(inlineStatus(mk({ job: job('transcribing') }))).toBe('處理中');
  });
  test('notes being written also count as 處理中', () => {
    expect(inlineStatus(mk({ transcript: transcript(['S0']), notesJob: { stage: 'generating' } as any }))).toBe('處理中');
  });
  test('a transcript → 已有逐字稿', () => {
    expect(inlineStatus(mk({ transcript: transcript(['S0']), notes: '# x' }))).toBe('已有逐字稿');
  });
  test('a failed run with nothing to show says so', () => {
    expect(inlineStatus(mk({ job: job('error') }))).toBe('整理沒有完成');
  });
  test('otherwise → 還沒生成', () => {
    expect(inlineStatus(mk())).toBe('還沒生成');
  });
});
