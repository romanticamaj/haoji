import { Easing } from 'react-native';
import { motion, duration } from '../motion';

// GUIDELINE / spec §5.3 E: three durations, one ease-out curve, nothing moves under Reduce Motion.
test('three durations: press 120, content 180, sheet 240', () => {
  expect(motion.press).toBe(120);
  expect(motion.content).toBe(180);
  expect(motion.sheet).toBe(240);
});

test('one ease-out curve (cubic)', () => {
  const ref = Easing.out(Easing.cubic);
  for (const t of [0, 0.25, 0.5, 0.75, 1]) expect(motion.easing(t)).toBeCloseTo(ref(t));
});

test('duration(kind, reduced) is the token, or 0 under Reduce Motion', () => {
  expect(duration('press', false)).toBe(120);
  expect(duration('content', false)).toBe(180);
  expect(duration('sheet', false)).toBe(240);
  expect(duration('press', true)).toBe(0);
  expect(duration('content', true)).toBe(0);
  expect(duration('sheet', true)).toBe(0);
});

test('no duration exceeds the 250 ms ceiling from the theme', () => {
  const { motion: themeMotion } = require('../theme');
  for (const k of ['press', 'content', 'sheet'] as const) expect(motion[k]).toBeLessThanOrEqual(themeMotion.maxDurationMs);
});
