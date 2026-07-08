// The LLM returns meeting notes as Markdown (headings, bold, bullet lists). "複製純文字" needs a
// readable plain-text version — strip the Markdown syntax while keeping the line/paragraph shape.
export function markdownToPlainText(md: string): string {
  const lines = (md ?? '').split(/\r?\n/).map((line) => {
    // horizontal rule (---, ***, ___) → blank line
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) return '';
    let l = line;
    l = l.replace(/^\s*>\s?/, '');            // blockquote marker
    l = l.replace(/^(\s{0,3})#{1,6}\s+/, '$1'); // heading markers (## 會議摘要 → 會議摘要)
    l = l.replace(/^(\s*)[-*+]\s+/, '$1• ');    // unordered bullet → •
    l = l.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // [text](url) → text
    l = l.replace(/\*\*([^*]+)\*\*/g, '$1');    // **bold**
    l = l.replace(/__([^_]+)__/g, '$1');        // __bold__
    l = l.replace(/\*([^*\n]+)\*/g, '$1');      // *italic* (after bold so ** is already gone)
    l = l.replace(/`([^`]+)`/g, '$1');          // `code`
    return l;
  });
  // collapse runs of blank lines to at most one, trim edges
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
