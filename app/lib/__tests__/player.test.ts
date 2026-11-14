import {
  clamp, xToRatio, ratioToMs, skipTo, nextSpeed, formatSpeed, waveformBars, barIsPlayed, locatePart,
  SKIP_BACK_MS, SKIP_FWD_MS,
} from '../player';

describe('locatePart', () => {
  test('single part: offset equals the global time', () => {
    expect(locatePart(12000, [61000])).toEqual({ part: 0, offsetMs: 12000 });
  });
  test('multi part: picks the containing part and its within-part offset', () => {
    const durs = [60000, 120000]; // part0 [0,60s), part1 [60s,180s)
    expect(locatePart(10000, durs)).toEqual({ part: 0, offsetMs: 10000 });
    expect(locatePart(60000, durs)).toEqual({ part: 1, offsetMs: 0 });
    expect(locatePart(95000, durs)).toEqual({ part: 1, offsetMs: 35000 });
  });
  test('a part with unknown (0) duration absorbs the remainder as best-effort', () => {
    expect(locatePart(90000, [60000, 0])).toEqual({ part: 1, offsetMs: 30000 });
  });
  test('past the end clamps into the last part', () => {
    expect(locatePart(999000, [60000, 120000])).toEqual({ part: 1, offsetMs: 939000 });
  });
  test('negative time floors to 0', () => {
    expect(locatePart(-500, [60000])).toEqual({ part: 0, offsetMs: 0 });
  });
});

describe('clamp', () => {
  test('bounds within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(20, 0, 10)).toBe(10);
  });
  test('inverted range falls back to lo', () => {
    expect(clamp(5, 10, 0)).toBe(10);
  });
});

describe('xToRatio', () => {
  test('maps x/width to 0..1', () => {
    expect(xToRatio(50, 100)).toBe(0.5);
    expect(xToRatio(0, 100)).toBe(0);
    expect(xToRatio(100, 100)).toBe(1);
  });
  test('clamps out-of-bounds x', () => {
    expect(xToRatio(-10, 100)).toBe(0);
    expect(xToRatio(150, 100)).toBe(1);
  });
  test('zero width is safe', () => {
    expect(xToRatio(50, 0)).toBe(0);
  });
});

describe('ratioToMs', () => {
  test('scales ratio to total', () => {
    expect(ratioToMs(0.5, 60000)).toBe(30000);
    expect(ratioToMs(0, 60000)).toBe(0);
    expect(ratioToMs(1, 60000)).toBe(60000);
  });
  test('unknown total is 0', () => {
    expect(ratioToMs(0.5, 0)).toBe(0);
  });
});

describe('skipTo', () => {
  test('adds delta and clamps to [0,total]', () => {
    expect(skipTo(20000, -SKIP_BACK_MS, 60000)).toBe(5000);
    expect(skipTo(50000, SKIP_FWD_MS, 60000)).toBe(60000); // clamped
    expect(skipTo(5000, -SKIP_BACK_MS, 60000)).toBe(0); // clamped at 0
  });
  test('unknown total still clamps at 0 on rewind', () => {
    expect(skipTo(5000, -SKIP_BACK_MS, 0)).toBe(0);
    expect(skipTo(5000, SKIP_FWD_MS, 0)).toBe(35000);
  });
});

describe('nextSpeed / formatSpeed', () => {
  test('cycles through the speed set', () => {
    expect(nextSpeed(1)).toBe(1.5);
    expect(nextSpeed(1.5)).toBe(2);
    expect(nextSpeed(2)).toBe(1);
  });
  test('unknown speed restarts the cycle', () => {
    expect(nextSpeed(3)).toBe(1);
  });
  test('formats one decimal + ×', () => {
    expect(formatSpeed(1)).toBe('1.0×');
    expect(formatSpeed(1.5)).toBe('1.5×');
    expect(formatSpeed(2)).toBe('2.0×');
  });
});

describe('waveformBars', () => {
  test('is deterministic and bounded 26..100', () => {
    const a = waveformBars(48);
    const b = waveformBars(48);
    expect(a).toEqual(b);
    expect(a).toHaveLength(48);
    for (const h of a) { expect(h).toBeGreaterThanOrEqual(26); expect(h).toBeLessThanOrEqual(100); }
  });
});

describe('barIsPlayed', () => {
  test('bar center before the playhead is played', () => {
    // count=10, ratio=0.5 → bars 0..4 played (centers 0.05..0.45), bar 5 not (0.55)
    expect(barIsPlayed(0, 10, 0.5)).toBe(true);
    expect(barIsPlayed(4, 10, 0.5)).toBe(true);
    expect(barIsPlayed(5, 10, 0.5)).toBe(false);
  });
  test('ratio 0 plays nothing', () => {
    expect(barIsPlayed(0, 10, 0)).toBe(false);
  });
});
