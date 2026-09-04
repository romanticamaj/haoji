import React from 'react';
import { render, act } from '@testing-library/react-native';

// Count what one metering sample actually costs by counting shared-value writes: every write is a
// value crossing to the UI thread, which is what has to be serialized. (withTiming is deliberately
// NOT asserted on — the project's global reanimated mock owns it, so a local spy never sees the
// call and any assertion on it would pass no matter what the component does.)
let mockWrites = 0;
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated/mock');
  return {
    ...actual,
    useSharedValue: (init: any) => {
      let v = init;
      return {
        get value() { return v; },
        set value(nv: any) { mockWrites += 1; v = nv; },
      };
    },
  };
});

import Waveform from '../Waveform';

const BARS = 48;

/** One metering sample, with the second render pass an effect-driven setState would schedule. */
async function sample(rerender: (el: React.ReactElement) => void, level: number) {
  mockWrites = 0;
  await act(async () => { rerender(<Waveform level={level} active />); });
  return mockWrites;
}

/**
 * The crash this guards (build 69, from TestFlight): every metering sample re-rendered all 48 bars
 * and started an animation on each, hundreds of worklet serializations a second. After 27 minutes
 * of recording the app died of a Hermes out-of-memory — mid-recording, so the WAV header was never
 * finalised and the meeting would not open at all.
 *
 * Measured here: the old build cost 49 writes per sample (one per bar, plus one), the current one
 * costs 4. The threshold sits well below "one per bar" so a return to per-bar work fails loudly.
 */
test('one metering sample costs a constant amount, not one write per bar', async () => {
  const { rerender } = await render(<Waveform level={0.1} active />);
  // Warm up first: while the ring buffer is still flat the bars' targets do not change, so the
  // very first sample is cheap even in the version that cost one write per bar. The steady state
  // during an actual meeting is what matters.
  for (let i = 0; i < 60; i++) await sample(rerender, (i % 10) / 10);

  const cost = await sample(rerender, 0.5);
  expect(cost).toBeLessThan(BARS / 2);
});

test('the per-sample cost does not drift up over a long recording', async () => {
  const { rerender } = await render(<Waveform level={0} active />);
  const early = await sample(rerender, 0.2);

  // A meeting's worth of samples. Anything that accumulates shows up as a rising per-sample cost.
  for (let i = 0; i < 400; i++) await sample(rerender, (i % 20) / 20);

  const late = await sample(rerender, 0.9);
  expect(late).toBe(early);
});

test('going inactive resets without a burst of per-bar work', async () => {
  const { rerender } = await render(<Waveform level={0.6} active />);
  mockWrites = 0;
  await act(async () => { rerender(<Waveform level={0} active={false} />); });
  expect(mockWrites).toBeLessThan(BARS / 2);
});
