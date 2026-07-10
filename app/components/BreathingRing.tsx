import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  withRepeat,
  withTiming,
  useAnimatedStyle,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { colors } from '../lib/theme';

const RING_SIZE = 200; // must match recordWrap size in RecordScreen
const BREATH_DURATION = 1600; // ms per half-cycle

export interface BreathingRingProps {
  active: boolean;
  level: number; // 0..1 — louder = slightly stronger glow
}

export default function BreathingRing({ active, level }: BreathingRingProps) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (active) {
      scale.value = withRepeat(
        withTiming(1.18, { duration: BREATH_DURATION, easing: Easing.inOut(Easing.ease) }),
        -1,
        true, // reverse: ping-pong 1 → 1.18 → 1
      );
      opacity.value = withRepeat(
        withTiming(0, { duration: BREATH_DURATION, easing: Easing.inOut(Easing.ease) }),
        -1,
        true, // reverse: 0.35 → 0 → 0.35
      );
      // Kick off from the "lit" state so first frame is visible
      opacity.value = 0.35;
    } else {
      cancelAnimation(scale);
      cancelAnimation(opacity);
      scale.value = withTiming(1, { duration: 300 });
      opacity.value = withTiming(0, { duration: 300 });
    }
  }, [active]);

  const animStyle = useAnimatedStyle(() => {
    // Extra level-driven boost on top of the breathing loop
    const levelBoost = level * 0.08; // max +8% scale, +4% opacity at full volume
    return {
      transform: [{ scale: scale.value + levelBoost }],
      opacity: opacity.value + level * 0.04,
    };
  });

  return <Animated.View style={[styles.ring, animStyle]} />;
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    backgroundColor: colors.brand,
  },
});
