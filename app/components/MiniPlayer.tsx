import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { IconChevronDown, IconPause, IconPlay } from './icons';
import { mmss } from '../lib/transcript';
import { formatSpeed } from '../lib/player';
import { duration, motion } from '../lib/motion';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { colors, fontScale, layout, radius, spacing, tabularNums } from '../lib/theme';

export const MINI_PLAYER_HEIGHT = 64;

// The docked player on Results (spec §5.3 C). Collapsed it is one 64pt bar — play/pause, a thin
// progress line, the time and the speed — so the transcript gets the screen. Tapping the bar expands
// to the full waveform card (`children`) in 240 ms.
//
// The card is ALWAYS mounted, only clipped to zero height while collapsed: the native player lives
// inside it, so unmounting it would stop the audio and lose the waveform the moment you collapse.
export function MiniPlayer({
  playing, positionMs, totalMs, speed, expanded, onToggle, onCycleSpeed, onExpandChange, children,
}: {
  playing: boolean;
  positionMs: number;
  totalMs: number;
  speed: number;
  expanded: boolean;
  onToggle(): void;
  onCycleSpeed(): void;
  onExpandChange(next: boolean): void;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const [cardH, setCardH] = useState(0);
  const open = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(open, {
      toValue: expanded ? 1 : 0,
      duration: duration('sheet', reduced),
      easing: motion.easing,
      useNativeDriver: false,   // animates height
    }).start();
  }, [expanded, reduced, open]);

  const known = totalMs > 0;
  const pos = Math.max(0, known ? Math.min(positionMs, totalMs) : positionMs);
  const frac = known ? pos / totalMs : 0;
  const time = `${mmss(pos / 1000)} / ${known ? mmss(totalMs / 1000) : '--:--'}`;

  return (
    <View style={styles.dock}>
      {expanded && (
        <Pressable
          onPress={() => onExpandChange(false)}
          style={({ pressed }) => [styles.collapse, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="收合播放器"
        >
          <IconChevronDown size={20} color={colors.muted} />
        </Pressable>
      )}
      <Animated.View
        testID="mini-card"
        style={[styles.clip, { height: open.interpolate({ inputRange: [0, 1], outputRange: [0, cardH] }) }]}
        accessibilityElementsHidden={!expanded}
        importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
        pointerEvents={expanded ? 'auto' : 'none'}
      >
        <View style={styles.measure} onLayout={(e) => setCardH(e.nativeEvent.layout.height)}>
          {children}
        </View>
      </Animated.View>

      {!expanded && (
        <View style={styles.bar}>
          <Pressable
            testID="mini-play"
            onPress={onToggle}
            style={({ pressed }) => [styles.play, pressed && styles.pressedFill]}
            accessibilityRole="button"
            accessibilityLabel={playing ? '暫停' : '播放'}
          >
            {playing ? <IconPause size={18} color={colors.onPrimary} /> : <IconPlay size={18} color={colors.onPrimary} />}
          </Pressable>

          <Pressable
            testID="mini-expand"
            onPress={() => onExpandChange(true)}
            style={({ pressed }) => [styles.mid, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="展開播放器"
            accessibilityState={{ expanded: false }}
          >
            <View
              testID="mini-progress"
              style={styles.track}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: Math.round(totalMs / 1000), now: Math.round(pos / 1000) }}
            >
              <View style={[styles.fill, { width: `${frac * 100}%` }]} />
            </View>
            <AppText variant="small" color="muted" style={tabularNums} maxFontSizeMultiplier={fontScale.chrome}>{time}</AppText>
          </Pressable>

          <Pressable
            onPress={onCycleSpeed}
            style={({ pressed }) => [styles.speed, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`播放速度 ${formatSpeed(speed)}`}
          >
            <AppText variant="cardTitle" color="heading" style={tabularNums} maxFontSizeMultiplier={fontScale.chrome}>
              {formatSpeed(speed)}
            </AppText>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { backgroundColor: colors.background, borderTopWidth: layout.border, borderTopColor: colors.outline },
  collapse: { alignItems: 'center', justifyContent: 'center', height: 28 },
  clip: { overflow: 'hidden' },
  // Absolutely placed so it lays out at its natural height inside a clip that may be 0 high (the
  // native waveform needs a real width to extract its samples).
  measure: { position: 'absolute', top: 0, left: 0, right: 0 },
  bar: {
    height: MINI_PLAYER_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: layout.screenPaddingH,
  },
  play: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, minHeight: layout.minTouchTarget, justifyContent: 'center', gap: spacing.xs },
  track: { height: 3, borderRadius: radius.round, backgroundColor: colors.outline, overflow: 'hidden' },
  fill: { height: 3, backgroundColor: colors.primary },
  speed: {
    height: layout.chipHeight, minWidth: 52, paddingHorizontal: spacing.md, borderRadius: radius.chip,
    backgroundColor: colors.surface, borderWidth: layout.border, borderColor: colors.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  pressedFill: { opacity: 0.8 },
});

export default MiniPlayer;
