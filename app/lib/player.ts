// Pure, UI-free helpers for the audio player. Kept here so the component stays thin and this
// logic is unit-testable (see lib/__tests__/player.test.ts).

export const SKIP_BACK_MS = 15_000;
export const SKIP_FWD_MS = 30_000;

// Playback-speed cycle for the 1.0× / 1.5× / 2.0× toggle (nitro-sound setPlaybackSpeed).
export const SPEEDS = [1, 1.5, 2] as const;
export type Speed = (typeof SPEEDS)[number];

export function nextSpeed(current: number): Speed {
  const i = SPEEDS.indexOf(current as Speed);
  return SPEEDS[(i + 1) % SPEEDS.length];
}

export function formatSpeed(rate: number): string {
  // 1 → "1.0×", 1.5 → "1.5×", 2 → "2.0×"
  return `${rate.toFixed(1)}×`;
}

export function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(hi, Math.max(lo, v));
}

// Convert a touched x-coordinate (relative to the bar's left edge) + the bar's pixel width into a
// 0..1 ratio. Guards against a zero/negative width so we never divide by zero.
export function xToRatio(x: number, width: number): number {
  if (width <= 0) return 0;
  return clamp(x / width, 0, 1);
}

// ratio (0..1) → absolute position in ms, clamped to the clip length.
export function ratioToMs(ratio: number, totalMs: number): number {
  if (totalMs <= 0) return 0;
  return Math.round(clamp(ratio, 0, 1) * totalMs);
}

// Position after a ±skip, clamped to [0, totalMs]. If total is unknown (0), still clamp at 0.
export function skipTo(positionMs: number, deltaMs: number, totalMs: number): number {
  const hi = totalMs > 0 ? totalMs : positionMs + Math.max(0, deltaMs);
  return clamp(positionMs + deltaMs, 0, hi);
}

// Deterministic waveform bar heights as percentages (26..100), mirroring the mockup's
// h = 26 + 30*|sin(i*0.65)| + 22*|sin(i*0.21+1.3)|. Precomputed once — NEVER Math.random in render.
export function waveformBars(count: number): number[] {
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    const h = 26 + Math.round(30 * Math.abs(Math.sin(i * 0.65)) + 22 * Math.abs(Math.sin(i * 0.21 + 1.3)));
    bars.push(Math.min(100, h));
  }
  return bars;
}

// A bar is "played" (brand-colored) when its center falls before the playhead ratio.
export function barIsPlayed(index: number, count: number, ratio: number): boolean {
  if (count <= 0) return false;
  return (index + 0.5) / count <= ratio;
}
