import { splitNotesForPreview } from '../gating';

const notes = `## 會議摘要
這是摘要第一行。
這是摘要第二行。

## 討論重點
- 重點一
- 重點二

## 決策
- 決策一`;

test('preview keeps only the 會議摘要 section; rest is locked', () => {
  const { preview, locked } = splitNotesForPreview(notes);
  expect(preview).toContain('## 會議摘要');
  expect(preview).toContain('摘要第二行');
  expect(preview).not.toContain('討論重點');
  expect(locked).toContain('## 討論重點');
  expect(locked).toContain('## 決策');
});

test('no 會議摘要 heading → preview is first 3 non-empty lines', () => {
  const plain = 'a\n\nb\nc\nd\ne';
  const { preview, locked } = splitNotesForPreview(plain);
  expect(preview.split('\n').filter(Boolean)).toEqual(['a', 'b', 'c']);
  expect(locked).toContain('d');
});
