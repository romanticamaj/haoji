import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, withTiming, useAnimatedStyle, SharedValue } from 'react-native-reanimated';
import { colors } from '../lib/theme';

const BAR_COUNT = 48;
const BAR_WIDTH = 3;
const MAX_HEIGHT = 60;
const MIN_HEIGHT = 3;
const ANIM_DURATION = 120; // ms — smooth but still feels live at ~7 Hz updates

const flat = () => Array<number>(BAR_COUNT).fill(MIN_HEIGHT);

/**
 * One bar. Its style worklet is created ONCE and reads the shared arrays every frame, so a new
 * metering sample costs nothing per bar — no re-render, no new animation, nothing to serialize.
 *
 * This is load-bearing, not a micro-optimisation. The previous version gave each bar its own shared
 * value and started a `withTiming` on every sample, driven by a `setState` that re-rendered all 48
 * bars — roughly 336 worklet serializations a second. Over a 27-minute meeting that is more than
 * half a million, and the app died of a Hermes out-of-memory with the recording still open, so the
 * WAV header was never finalised and the file would not play. Recording longer must not cost more.
 */
function Bar({ index, prev, next, t }: {
  index: number;
  prev: SharedValue<number[]>;
  next: SharedValue<number[]>;
  t: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const a = prev.value[index] ?? MIN_HEIGHT;
    const b = next.value[index] ?? MIN_HEIGHT;
    return { height: a + (b - a) * t.value };
  });
  return <Animated.View style={[styles.bar, style]} />;
}

export interface WaveformProps {
  level: number;   // 0..1
  active: boolean;
}

export default function Waveform({ level, active }: WaveformProps) {
  // Ring buffer of bar heights, kept on the UI thread. `t` drives the crossfade from prev to next,
  // so one sample starts ONE animation for the whole waveform instead of one per bar.
  const prev = useSharedValue<number[]>(flat());
  const next = useSharedValue<number[]>(flat());
  const t = useSharedValue(1);

  const historyRef = useRef<number[]>(flat());
  const cursorRef = useRef(0);

  useEffect(() => {
    if (!active) {
      historyRef.current = flat();
      cursorRef.current = 0;
      prev.value = flat();
      next.value = flat();
      t.value = 1;
      return;
    }

    historyRef.current[cursorRef.current % BAR_COUNT] =
      MIN_HEIGHT + level * (MAX_HEIGHT - MIN_HEIGHT);
    cursorRef.current += 1;

    // Oldest bar first (left), newest last (right).
    const cursor = cursorRef.current;
    const ordered = Array.from(
      { length: BAR_COUNT },
      (_, i) => historyRef.current[(cursor + i) % BAR_COUNT],
    );

    prev.value = next.value;
    next.value = ordered;
    t.value = 0;
    t.value = withTiming(1, { duration: ANIM_DURATION });
  }, [level, active]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={styles.container}>
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <Bar key={i} index={i} prev={prev} next={next} t={t} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    // Fill the full width: space-between spreads the fixed-width bars edge-to-edge instead of packing
    // them on the left (which left the right half empty and looked broken).
    justifyContent: 'space-between',
    width: '100%',
    height: MAX_HEIGHT + 8,
    paddingHorizontal: 4,
  },
  bar: {
    width: BAR_WIDTH,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
});
