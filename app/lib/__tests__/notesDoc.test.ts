import { notesMetaLine, parseTaskItem } from '../notesDoc';
import { SavedSession } from '../store';

const NOW = new Date('2026-07-10T14:30:00').getTime();

function session(over: Partial<SavedSession> = {}): SavedSession {
  return {
    id: 's', createdAt: NOW, title: 't', unlocked: false, names: {}, parts: [], ...over,
  };
}

describe('notesMetaLine', () => {
  test('full line: minutes · speakers · relative day', () => {
    const s = session({
      parts: [{ uri: 'a', durationMs: 42 * 60000 }],
      transcript: { speakers: ['A', 'B', 'C', 'D'], segments: [] },
    });
    expect(notesMetaLine(s, NOW)).toBe('42 分鐘 · 4 位參與者 · 今天 14:30');
  });

  test('omits duration chip when total is 0', () => {
    const s = session({
      parts: [{ uri: 'a', durationMs: 0 }],
      transcript: { speakers: ['A', 'B'], segments: [] },
    });
    expect(notesMetaLine(s, NOW)).toBe('2 位參與者 · 今天 14:30');
  });

  test('omits speaker chip when there is no transcript', () => {
    const s = session({ parts: [{ uri: 'a', durationMs: 5 * 60000 }] });
    expect(notesMetaLine(s, NOW)).toBe('5 分鐘 · 今天 14:30');
  });

  test('relative day only when nothing else is known', () => {
    expect(notesMetaLine(session(), NOW)).toBe('今天 14:30');
  });
});

describe('parseTaskItem', () => {
  test('returns null for a non-task bullet', () => {
    expect(parseTaskItem('一般重點')).toBeNull();
    expect(parseTaskItem('[未完成] 不是 checkbox')).toBeNull();
  });

  test('unchecked task', () => {
    expect(parseTaskItem('[ ] 彙整匯出功能需求規格')).toEqual({ done: false, text: '彙整匯出功能需求規格' });
  });

  test('checked task (x and X)', () => {
    expect(parseTaskItem('[x] 整理留存數據儀表板')).toEqual({ done: true, text: '整理留存數據儀表板' });
    expect(parseTaskItem('[X] 完成')).toEqual({ done: true, text: '完成' });
  });

  test('parses a trailing @owner', () => {
    expect(parseTaskItem('[ ] 彙整需求規格 @陳專員')).toEqual({ done: false, text: '彙整需求規格', owner: '陳專員' });
  });

  test('parses a trailing (owner) / （owner）', () => {
    expect(parseTaskItem('[x] 整理儀表板（宏）')).toEqual({ done: true, text: '整理儀表板', owner: '宏' });
    expect(parseTaskItem('[ ] 排程 (Gary)')).toEqual({ done: false, text: '排程', owner: 'Gary' });
  });
});
