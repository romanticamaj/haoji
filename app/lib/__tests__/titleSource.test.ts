import { canAdoptAiTitle, promoteTitleFromNotes, extractNotesTitle } from '../notesDoc';
import { SavedSession } from '../store';

const base: SavedSession = {
  id: 's', createdAt: 1, title: '2026/9/2 下午2:15', unlocked: false, names: {}, parts: [],
};
const notes = '# 電池模組供應商選擇\n\n## 會議目的\n\n決定供應商。\n';

test('a timestamp default is the app\'s to replace', () => {
  expect(canAdoptAiTitle(base)).toBe(true);
  expect(promoteTitleFromNotes({ ...base, notes })).toMatchObject({
    title: '電池模組供應商選擇', titleSource: 'ai',
  });
});

// The bug this guards: once an AI title landed, the title no longer looked like a timestamp, so
// re-analysing could never update it again — even when the new notes described the meeting better.
test('a title the app derived earlier is refreshed by a later analysis', () => {
  const earlier: SavedSession = { ...base, title: '舊的主題', titleSource: 'ai', notes };
  expect(canAdoptAiTitle(earlier)).toBe(true);
  expect(promoteTitleFromNotes(earlier).title).toBe('電池模組供應商選擇');
});

test('a title the user typed is never overwritten', () => {
  const mine: SavedSession = { ...base, title: '跟客戶的週會', titleSource: 'user', notes };
  expect(canAdoptAiTitle(mine)).toBe(false);
  expect(promoteTitleFromNotes(mine)).toBe(mine);          // same reference: no store write
});

// Meetings saved before titleSource existed carry no marker; the old rule still applies to them.
test('an older meeting with a typed-looking title is left alone', () => {
  const legacy: SavedSession = { ...base, title: '產品方向討論', notes };
  expect(canAdoptAiTitle(legacy)).toBe(false);
  expect(promoteTitleFromNotes(legacy)).toBe(legacy);
});

test('nothing changes when the notes carry no topic line', () => {
  const noTitle: SavedSession = { ...base, notes: '## 會議目的\n\n決定供應商。\n' };
  expect(extractNotesTitle(noTitle.notes!)).toBeNull();
  expect(promoteTitleFromNotes(noTitle)).toBe(noTitle);
});

test('re-running with an unchanged title does not churn the store', () => {
  const same: SavedSession = { ...base, title: '電池模組供應商選擇', titleSource: 'ai', notes };
  expect(promoteTitleFromNotes(same)).toBe(same);
});

test('the 會議記錄： prefix is stripped from the topic', () => {
  const prefixed = { ...base, notes: '# 會議記錄：電池模組供應商選擇\n\n## 會議目的\n' };
  expect(promoteTitleFromNotes(prefixed).title).toBe('電池模組供應商選擇');
});
