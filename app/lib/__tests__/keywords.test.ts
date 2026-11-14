import { applyRules, countMatches, applyRulesToSession } from '../keywords';
import { SavedSession } from '../store';

const session: SavedSession = {
  id: 's', createdAt: 1, title: 't', unlocked: false, names: {}, parts: [],
  transcript: { speakers: ['A'], segments: [
    { start: 0, end: 1, speaker: 'A', text: '我們用 Claude 服務' },
    { start: 1, end: 2, speaker: 'A', text: 'Claude 很好' },
  ] },
  notes: '## 摘要\n決定採用 Claude',
};

test('applyRules replaces all literal occurrences, case-sensitive', () => {
  expect(applyRules('Claude and Claude', [{ from: 'Claude', to: 'cloud' }])).toBe('cloud and cloud');
  expect(applyRules('claudia', [{ from: 'Claude', to: 'cloud' }])).toBe('claudia'); // case-sensitive
});

test('countMatches totals occurrences across transcript + notes', () => {
  expect(countMatches(session, [{ from: 'Claude', to: 'cloud' }])).toBe(3); // 2 in segments, 1 in notes
  expect(countMatches(session, [{ from: '', to: 'x' }])).toBe(0);
});

test('applyRulesToSession rewrites segments and archives the pre-replace notes', () => {
  const out = applyRulesToSession(session, [{ from: 'Claude', to: 'cloud' }], 1234);
  expect(out.transcript!.segments.map((s) => s.text)).toEqual(['我們用 cloud 服務', 'cloud 很好']);
  expect(out.notes).toBe('## 摘要\n決定採用 cloud');
  expect(out.notesHistory).toEqual([{ notes: '## 摘要\n決定採用 Claude', at: 1234 }]);
});

test('applyRulesToSession is a no-op with no active rules', () => {
  expect(applyRulesToSession(session, [{ from: '', to: 'x' }], 1)).toBe(session);
});
