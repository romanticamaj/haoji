import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { IconChevronLeft } from './icons';
import { colors, fontScale, layout, spacing } from '../lib/theme';

// The one flat header for pushed screens (Settings, Pair, Review, Processing): a 20 pt chevron in a
// 44 pt target, the title centred at 17/600, on the canvas colour. No glass button, no shadow, no
// rule. Without `onBack` (Review, Processing: nowhere sensible to go back to) the left slot stays
// empty so the title is still centred.
export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View testID="screen-header" style={[styles.bar, { paddingTop: insets.top }]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={4}
        >
          <IconChevronLeft size={20} />
        </Pressable>
      ) : (
        <View style={styles.btn} />
      )}
      <AppText
        variant="cardTitle"
        color="heading"
        style={styles.title}
        numberOfLines={1}
        maxFontSizeMultiplier={fontScale.chrome}
        accessibilityRole="header"
      >
        {title}
      </AppText>
      <View style={styles.btn} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.sm, backgroundColor: colors.background,
  },
  btn: { width: layout.minTouchTarget, height: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});

export default ScreenHeader;
