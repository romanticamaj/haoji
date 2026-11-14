// AI meeting notes sometimes come back with LaTeX math ($\rightarrow$, \(...\)) and mis-formatted
// headings (no space after #, no blank line before a section), which react-native-markdown-display
// renders as raw "$lrightarrow$" garbage or squished-together titles. cleanNotesMarkdown normalises
// the LLM output into clean Markdown. Applied before rendering / copying / exporting AND defensively
// on already-saved notes, so existing meetings look right without being regenerated.

// True when the text inside a `$...$` span is actually math (not a stray currency amount like "$5").
function looksLikeMath(inner: string): boolean {
  const t = inner.toLowerCase().trim();
  if (inner.includes('\\')) return true;
  if (t.includes('arrow')) return true;
  if (['to', 'times', 'approx', 'leq', 'geq', 'neq', 'pm', 'cdot'].includes(t)) return true;
  return /^[-<>=]{1,3}$/.test(t);
}

// Map a math span's inner text (or a bare LaTeX command) to a readable symbol. Arrows are matched by
// substring so a dropped backslash or stray prefix (the observed "$lrightarrow$") still resolves.
function mathSpanToText(inner: string): string {
  const t = inner.replace(/\\/g, '').replace(/\s+/g, '').toLowerCase();
  if (!t) return '';
  if (t.includes('leftrightarrow') || t === '<->') return ' ↔ ';
  if (t.includes('rightarrow') || t === 'to' || t === '->' || t === '=>') return ' → ';
  if (t.includes('leftarrow') || t === '<-') return ' ← ';
  if (t === 'times') return ' × ';
  if (t === 'approx') return ' ≈ ';
  if (t === 'leq') return ' ≤ ';
  if (t === 'geq') return ' ≥ ';
  if (t === 'neq') return ' ≠ ';
  return inner.trim(); // unknown math → keep the inner content, just drop the $ delimiters
}

export function cleanNotesMarkdown(md: string): string {
  let s = md ?? '';

  // Math delimiters → symbols/text. $$...$$ before $...$; then \(...\) and \[...\].
  s = s.replace(/\$\$([^$]{0,60})\$\$/g, (m, x) => (looksLikeMath(x) ? mathSpanToText(x) : m));
  s = s.replace(/\$([^$\n]{0,40})\$/g, (m, x) => (looksLikeMath(x) ? mathSpanToText(x) : m));
  s = s.replace(/\\\(([\s\S]{0,60}?)\\\)/g, (_, x) => mathSpanToText(x));
  s = s.replace(/\\\[([\s\S]{0,60}?)\\\]/g, (_, x) => mathSpanToText(x));

  // Bare LaTeX arrow commands sitting outside any math delimiters.
  s = s.replace(/\\(?:longrightarrow|rightarrow|to)\b/g, ' → ');
  s = s.replace(/\\(?:longleftarrow|leftarrow)\b/g, ' ← ');
  s = s.replace(/\\leftrightarrow\b/g, ' ↔ ');

  // Collapse the doubled spaces the arrow substitution can create, without touching line-leading
  // indentation (which carries list nesting).
  s = s.replace(/(\S)[ \t]{2,}/g, '$1 ');

  // Heading hygiene so sections don't squish: a space after the #'s, and a blank line before a
  // heading that follows a non-blank line.
  s = s.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');
  s = s.replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2');

  return s;
}
