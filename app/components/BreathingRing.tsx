import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
  Easing,
} from 'react-native-reanimated';
import { colors } from '../lib/theme';
import { useReduceMotion } from '../hooks/useReduceMotion';

const RING_SIZE = 168; // must match recordWrap size in RecordScreen
const REACT_MS = 130;  // smoothing per metering update (~7 Hz) — tracks volume without strobing

export interface BreathingRingProps {
  active: boolean;
  level: number; // 0..1 — the live mic level; the glow tracks this (louder = bigger, brighter)
}

// The glow around the record button reacts to the mic volume, matching the waveform: at silence it
// sits small and faint, and it swells + brightens with loudness. Driven straight off `level` (not a
// fixed breathing loop) so it feels like a direct response to what you're saying.
export default function BreathingRing({ active, level }: BreathingRingProps) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    // Reduce Motion: a still, faint halo that only says "recording" — no swelling with the voice.
    const lvl = active && !reduceMotion ? Math.max(0, Math.min(1, level)) : 0;
    // A quiet sage halo (≤25% — GUIDELINE §7.1): a soft floor while recording, the level adds a swell.
    const targetScale = 1 + lvl * 0.2;
    const targetOpacity = active ? 0.1 + lvl * 0.15 : 0;
    scale.value = withTiming(targetScale, { duration: REACT_MS, easing: Easing.out(Easing.quad) });
    opacity.value = withTiming(targetOpacity, { duration: REACT_MS, easing: Easing.out(Easing.quad) });
  }, [active, level, reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return <Animated.View style={[styles.ring, animStyle]} />;
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    backgroundColor: colors.primary,
  },
});
