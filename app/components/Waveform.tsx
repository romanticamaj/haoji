import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, withTiming, useAnimatedStyle } from 'react-native-reanimated';

const BAR_COUNT = 48;
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const MAX_HEIGHT = 60;
const MIN_HEIGHT = 3;
const RED = '#E5342B';
const ANIM_DURATION = 120; // ms — smooth but still feels live at ~7 Hz updates

/** One animated bar — manages its own reanimated shared value so hooks are at top level */
function Bar({ target }: { target: number }) {
  const heightSV = useSharedValue(MIN_HEIGHT);

  useEffect(() => {
    heightSV.value = withTiming(target, { duration: ANIM_DURATION });
  }, [target]);

  const style = useAnimatedStyle(() => ({
    height: heightSV.value,
  }));

  return <Animated.View style={[styles.bar, style]} />;
}

export interface WaveformProps {
  level: number;   // 0..1
  active: boolean;
}

export default function Waveform({ level, active }: WaveformProps) {
  // Rolling ring buffer stored as plain React state (array of heights in pixels)
  const historyRef = useRef<number[]>(Array(BAR_COUNT).fill(MIN_HEIGHT));
  const cursorRef = useRef(0);
  const [heights, setHeights] = useState<number[]>(() => Array(BAR_COUNT).fill(MIN_HEIGHT));

  useEffect(() => {
    if (!active) {
      historyRef.current = Array(BAR_COUNT).fill(MIN_HEIGHT);
      cursorRef.current = 0;
      setHeights(Array(BAR_COUNT).fill(MIN_HEIGHT));
      return;
    }

    // Push new sample into ring buffer
    historyRef.current[cursorRef.current % BAR_COUNT] = MIN_HEIGHT + level * (MAX_HEIGHT - MIN_HEIGHT);
    cursorRef.current += 1;

    // Re-order so oldest bar is first (left) and newest is last (right)
    const cursor = cursorRef.current;
    const ordered = Array.from(
      { length: BAR_COUNT },
      (_, i) => historyRef.current[(cursor + i) % BAR_COUNT],
    );
    setHeights(ordered);
  }, [level, active]);

  return (
    <View style={styles.container}>
      {heights.map((h, i) => (
        <Bar key={i} target={h} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: MAX_HEIGHT + 8,
    gap: BAR_GAP,
    paddingHorizontal: 8,
  },
  bar: {
    width: BAR_WIDTH,
    backgroundColor: RED,
    borderRadius: 2,
  },
});
