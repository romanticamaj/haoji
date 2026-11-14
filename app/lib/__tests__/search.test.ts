import { searchSessions, SNIPPET_RADIUS, MAX_HITS_PER_SESSION } from '../search';
import { SavedSession } from '../store';
import { Segment } from '../types';

const mk = (over: Partial<SavedSession> = {}): SavedSession => ({
  id: 'x', createdAt: 1, title: '會議', names: {}, unlocked: false, parts: [], ...over,
});
const seg = (text: string, speaker = 'SPEAKER_00', i = 0): Segment => ({ start: i * 5, end: i * 5 + 5, speaker, text });
const tx = (texts: string[], speakers = ['SPEAKER_00']) => ({
  speakers,
  segments: texts.map((t, i) => seg(t, speakers[i % speakers.length], i)),
});

// The highlighted part of a hit, read back from its own snippet.
const hl = (h: { snippet: string; matchStart: number; matchLen: number }) =>
  h.snippet.slice(h.matchStart, h.matchStart + h.matchLen);

test('an empty or blank query finds nothing', () => {
  const s = [mk({ title: 'abc' })];
  expect(searchSessions(s, '')).toEqual([]);
  expect(searchSessions(s, '   ')).toEqual([]);
});

test('search width-insensitive: full-width ＡＢＣ matches abc, and case is ignored', () => {
  const s = [mk({ id: 'a', title: 'Sprint ABC 週會' }), mk({ id: 'b', title: '客戶訪談', transcript: tx(['我們談 abc 的事']) })];
  const byQ = searchSessions(s, 'ＡＢＣ');
  expect(byQ.map((h) => h.sessionId).sort()).toEqual(['a', 'b']);
  // The highlight points at the ORIGINAL characters, not the normalised ones.
  expect(hl(byQ.find((h) => h.sessionId === 'a')!)).toBe('ABC');
  expect(hl(byQ.find((h) => h.sessionId === 'b')!)).toBe('abc');
  // …and the other direction: a full-width title found by a half-width query.
  const fw = searchSessions([mk({ id: 'c', title: 'ＡＢＣ會議' })], 'abc');
  expect(fw).toHaveLength(1);
  expect(hl(fw[0])).toBe('ＡＢＣ');
});

test('ranking: title, then speaker, then notes, then transcript; newest first within a rank', () => {
  const s = [
    mk({ id: 'tx-old', createdAt: 1, transcript: tx(['預算要再討論']) }),
    mk({ id: 'notes', createdAt: 2, notes: '## 重點\n預算超支' }),
    mk({ id: 'speaker', createdAt: 3, names: { SPEAKER_00: '預算組' }, transcript: tx(['你好']) }),
    mk({ id: 'title', createdAt: 0, title: '預算會議' }),
    mk({ id: 'tx-new', createdAt: 9, transcript: tx(['預算']) }),
  ];
  const hits = searchSessions(s, '預算');
  expect(hits.map((h) => `${h.field}:${h.sessionId}`)).toEqual([
    'title:title', 'speaker:speaker', 'notes:notes', 'transcript:tx-new', 'transcript:tx-old',
  ]);
});

test('a transcript hit carries the segment index so Results can open at that turn', () => {
  const s = [mk({ id: 'a', transcript: tx(['開場', '先談上線時程', '再談預算']) })];
  const [h] = searchSessions(s, '預算');
  expect(h).toMatchObject({ field: 'transcript', segmentIndex: 2 });
  expect(hl(h)).toBe('預算');
});

test('a speaker hit points at that speaker’s first turn', () => {
  const s = [mk({ id: 'a', names: { SPEAKER_01: '王經理' }, transcript: tx(['嗨', '大家好', '開始'], ['SPEAKER_00', 'SPEAKER_01']) })];
  const [h] = searchSessions(s, '經理');
  expect(h).toMatchObject({ field: 'speaker', segmentIndex: 1, snippet: '王經理' });
});

test('speaker names can be overridden per session', () => {
  const s = [mk({ id: 'a', transcript: tx(['嗨']) })];
  expect(searchSessions(s, '小美')).toEqual([]);
  expect(searchSessions(s, '小美', { a: { SPEAKER_00: '小美' } })[0]).toMatchObject({ field: 'speaker', sessionId: 'a' });
});

test(`at most ${3} hits per session`, () => {
  expect(MAX_HITS_PER_SESSION).toBe(3);
  const s = [mk({ id: 'a', title: '預算', notes: '預算 預算', transcript: tx(['預算', '預算', '預算']) })];
  const hits = searchSessions(s, '預算');
  expect(hits).toHaveLength(3);
  expect(hits[0].field).toBe('title');
});

test('the snippet window is ±20 characters around the match, with … where it was cut', () => {
  expect(SNIPPET_RADIUS).toBe(20);
  const before = '一'.repeat(30);
  const after = '二'.repeat(30);
  const [h] = searchSessions([mk({ transcript: tx([`${before}關鍵字${after}`]) })], '關鍵字');
  expect(h.snippet).toBe(`…${'一'.repeat(20)}關鍵字${'二'.repeat(20)}…`);
  expect(h.matchStart).toBe(21);
  expect(h.matchLen).toBe(3);
  expect(hl(h)).toBe('關鍵字');
});

test('a short text is shown whole, without …, and line breaks in notes become spaces', () => {
  const [h] = searchSessions([mk({ notes: '# 標題\n- 預算超支' })], '預算');
  expect(h.snippet).toBe('# 標題 - 預算超支');
  expect(hl(h)).toBe('預算');
});

test('search perf: 200 sessions with 2-hour transcripts in under 100 ms', () => {
  // ~2 h of speech: 1,440 five-second turns of ~20 characters each.
  const filler = '我們今天要討論的是下一季的產品規劃與時程安排';
  const sessions = Array.from({ length: 200 }, (_, i) => mk({
    id: `s${i}`,
    createdAt: i,
    title: `會議 ${i}`,
    notes: `## 會議摘要\n${filler.repeat(40)}`,
    transcript: tx(Array.from({ length: 1440 }, (_, k) => (k === 1439 && i % 50 === 0 ? `${filler}Kubernetes` : filler)),
      ['SPEAKER_00', 'SPEAKER_01']),
  }));
  // Best of three: the budget is about the algorithm, not about jest workers competing for the CPU.
  let hits: ReturnType<typeof searchSessions> = [];
  let ms = Infinity;
  for (let run = 0; run < 3; run++) {
    const t0 = Date.now();
    hits = searchSessions(sessions, 'ｋｕｂｅｒｎｅｔｅｓ');
    ms = Math.min(ms, Date.now() - t0);
  }
  expect(hits).toHaveLength(4);
  expect(hits[0]).toMatchObject({ sessionId: 's150', field: 'transcript', segmentIndex: 1439 });
  expect(ms).toBeLessThan(100);
});
