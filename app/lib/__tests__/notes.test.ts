import { markdownToPlainText } from '../notes';

test('strips heading markers but keeps the text', () => {
  expect(markdownToPlainText('## 會議摘要\n內容')).toBe('會議摘要\n內容');
});

test('strips bold/italic/code inline markers', () => {
  expect(markdownToPlainText('**重點** 與 *斜體* 與 `code`')).toBe('重點 與 斜體 與 code');
});

test('converts unordered bullets to • and keeps ordered lists', () => {
  expect(markdownToPlainText('- 一\n- 二\n1. 三')).toBe('• 一\n• 二\n1. 三');
});

test('links become their text', () => {
  expect(markdownToPlainText('見 [文件](https://x.y/z)')).toBe('見 文件');
});

test('drops horizontal rules and collapses extra blank lines', () => {
  expect(markdownToPlainText('甲\n\n\n---\n\n乙')).toBe('甲\n\n乙');
});

test('a full notes doc has no markdown syntax left', () => {
  const md = '## 會議摘要\n**決議**：上線\n\n## 待辦\n- [x] A\n- B';
  const out = markdownToPlainText(md);
  expect(out).not.toMatch(/[#*`]/);
  expect(out).toContain('會議摘要');
  expect(out).toContain('決議：上線');
});

test('handles empty / undefined input', () => {
  expect(markdownToPlainText('')).toBe('');
  expect(markdownToPlainText(undefined as any)).toBe('');
});
