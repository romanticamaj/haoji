import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { IconChevronLeft, IconMore } from './icons';
import { colors, fontScale, layout, spacing } from '../lib/theme';

// Results' own header (spec §5.3 C): back · the meeting title on ONE line · `…`. The native header
// spent a full row on the title plus a pencil, and every other action lived further down the page;
// now everything about the meeting sits behind `…` (OverflowMenu) and the transcript starts higher.
export function ResultsHeader({ title, onBack, onMore }: { title: string; onBack(): void; onMore(): void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <Pressable
        onPress={onBack}
        style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="返回"
        hitSlop={4}
      >
        <IconChevronLeft size={26} />
      </Pressable>
      <AppText
        variant="cardTitle"
        color="heading"
        style={styles.title}
        numberOfLines={1}
        ellipsizeMode="tail"
        maxFontSizeMultiplier={fontScale.chrome}
        accessibilityRole="header"
      >
        {title}
      </AppText>
      <Pressable
        onPress={onMore}
        style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="更多動作"
        hitSlop={4}
      >
        <IconMore size={24} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.sm, backgroundColor: colors.background,
  },
  btn: { width: layout.minTouchTarget, height: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center' },
  // flexShrink lets a long title give way to the two buttons instead of pushing `…` off screen.
  title: { flex: 1, flexShrink: 1, fontWeight: '600', textAlign: 'center', fontSize: 17 },
  pressed: { opacity: 0.6 },
});

export default ResultsHeader;
