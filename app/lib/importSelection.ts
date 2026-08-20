import { ProbeResult } from './audioMerge';

// Picking several files says "these belong together", but it does not say they are all usable, in the
// right order, or even audio. This module holds the (pure, testable) rules behind the confirmation
// step; the screen only renders them.

export type ImportCandidate = {
  uri: string;
  name: string;
  ok: boolean;
  durationMs: number;
  reason?: string;
  selected: boolean;
};

/** Merge the picked files with what probing found. Unusable files start unselected. */
export function buildCandidates(
  files: { uri: string; name: string }[], probes: ProbeResult[],
): ImportCandidate[] {
  return files.map((f) => {
    const p = probes.find((r) => r.path === f.uri);
    const ok = p?.ok ?? true;
    return {
      uri: f.uri,
      name: f.name,
      ok,
      durationMs: p?.durationMs ?? 0,
      reason: p?.reason,
      selected: ok,          // never pre-select something we know is unusable
    };
  });
}

export const toggle = (list: ImportCandidate[], uri: string): ImportCandidate[] =>
  // An unusable file can't be selected at all — toggling it would only lead to a failure later.
  list.map((c) => (c.uri === uri && c.ok ? { ...c, selected: !c.selected } : c));

export const selected = (list: ImportCandidate[]) => list.filter((c) => c.selected && c.ok);

/** Joining needs at least two usable, selected files. */
export const canMerge = (list: ImportCandidate[]) => selected(list).length >= 2;

/** Nothing usable selected → there is nothing to import. */
export const canImport = (list: ImportCandidate[]) => selected(list).length >= 1;

export const totalDurationMs = (list: ImportCandidate[]) =>
  selected(list).reduce((a, c) => a + (c.durationMs || 0), 0);
