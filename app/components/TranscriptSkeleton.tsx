import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { motion } from '../lib/motion';
import { colors, layout, radius, spacing } from '../lib/theme';

// Six placeholder turns (avatar + name + two or three lines) shown while Results mounts its content,
// in place of a spinner, so the page already has the transcript's shape. A slow, quiet pulse; under
// Reduce Motion it holds still.
const TURNS = 6;
// Line widths vary per turn so the block reads as text, not a grid.
const LINES: number[][] = [[92, 64], [86, 90, 40], [78, 55], [95, 70], [88, 92, 52], [72, 45]];
const PULSE_MS = 900;

export function TranscriptSkeleton() {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.55, duration: PULSE_MS, easing: motion.easing, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, easing: motion.easing, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced, pulse]);

  return (
    <View
      testID="results-skeleton"
      style={styles.wrap}
      accessible
      accessibilityLabel="正在載入逐字稿…"
      accessibilityState={{ busy: true }}
    >
      <Animated.View style={{ opacity: pulse }}>
        {Array.from({ length: TURNS }, (_, i) => (
          <View key={i} testID="skeleton-turn" style={styles.turn}>
            <View style={styles.head}>
              <View style={styles.avatar} />
              <View style={[styles.bar, styles.name]} />
            </View>
            {LINES[i % LINES.length].map((w, j) => (
              <View key={j} style={[styles.bar, styles.line, { width: `${w}%` }]} />
            ))}
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: layout.screenPaddingH, paddingTop: spacing.md, backgroundColor: colors.background },
  turn: { paddingVertical: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primarySoft },
  bar: { height: 12, borderRadius: radius.round, backgroundColor: colors.primarySoft },
  name: { width: 72 },
  line: { height: 14 },
});

export default TranscriptSkeleton;
