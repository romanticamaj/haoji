import { cleanNotesMarkdown } from '../notesClean';

test('converts leaked LaTeX arrows (incl. the observed $lrightarrow$) to real arrows', () => {
  const out = cleanNotesMarkdown('篩選/過濾$lrightarrow$ 撰寫（Writing）$lrightarrow$ 完成');
  expect(out).toContain('→');
  expect(out).not.toContain('lrightarrow');
  expect(out).not.toContain('$');
});

test('handles \\rightarrow and \\(...\\) forms', () => {
  expect(cleanNotesMarkdown('A \\rightarrow B')).toContain('→');
  expect(cleanNotesMarkdown('X \\(\\to\\) Y')).toContain('→');
});

test('leaves plain currency amounts alone (not treated as math)', () => {
  const out = cleanNotesMarkdown('預算 $5 到 $10 之間');
  expect(out).toBe('預算 $5 到 $10 之間');
});

test('adds a space after # when missing so headings parse', () => {
  expect(cleanNotesMarkdown('##會議摘要')).toBe('## 會議摘要');
});

test('inserts a blank line before a heading glued to the previous line (fixes squished titles)', () => {
  const out = cleanNotesMarkdown('本次討論預算\n## 待辦\n- 做事');
  expect(out).toBe('本次討論預算\n\n## 待辦\n- 做事');
});

test('keeps well-formed markdown unchanged', () => {
  const md = '## 會議摘要\n\n本次討論預算與時程。\n\n## 待辦\n\n- [ ] 王小明 彙整需求';
  expect(cleanNotesMarkdown(md)).toBe(md);
});
