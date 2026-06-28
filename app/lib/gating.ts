// Free preview = the 會議摘要 section only; everything else is locked behind IAP.
export function splitNotesForPreview(notes: string): { preview: string; locked: string } {
  const lines = notes.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => /^##\s*會議摘要/.test(l.trim()));
  if (startIdx === -1) {
    // Fallback: first 3 non-empty lines are the preview.
    const preview: string[] = [];
    let i = 0;
    for (; i < lines.length && preview.length < 3; i++) {
      if (lines[i].trim()) preview.push(lines[i]);
    }
    return { preview: preview.join('\n'), locked: lines.slice(i).join('\n').trim() };
  }
  // Find the next "## " heading after the summary section.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) { endIdx = i; break; }
  }
  return {
    preview: lines.slice(startIdx, endIdx).join('\n').trim(),
    locked: lines.slice(endIdx).join('\n').trim(),
  };
}
