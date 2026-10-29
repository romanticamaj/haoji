import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { IconSearch } from './icons';
import { brand, colors, layout, spacing } from '../lib/theme';

// Home's brand lock-up: 「好記 HAOJI」 + tagline on the left, a round outlined search button on the
// right (KEEPLACE src/components/BrandHeader.tsx, GUIDELINE §3/§7). The whole lock-up reads as ONE
// accessibility header.
export function BrandHeader({ onSearch, searching }: { onSearch?: () => void; searching?: boolean }) {
  return (
    <View style={styles.row}>
      <View
        style={styles.brand}
        accessible
        accessibilityRole="header"
        accessibilityLabel={`${brand.nameZh} ${brand.nameEn}，${brand.tagline}`}
      >
        <View style={styles.wordmarkRow}>
          <AppText variant="display" color="heading" style={styles.nameZh} maxFontSizeMultiplier={1.3}>
            {brand.nameZh}
          </AppText>
          <AppText variant="wordmark" color="muted" style={styles.nameEn} maxFontSizeMultiplier={1.3}>
            {brand.nameEn}
          </AppText>
        </View>
        <AppText variant="small" color="muted" maxFontSizeMultiplier={1.5}>{brand.tagline}</AppText>
      </View>
      {onSearch ? (
        <Pressable
          testID="home-search-toggle"
          accessibilityRole="button"
          accessibilityLabel={searching ? '關閉搜尋' : '搜尋會議'}
          accessibilityState={{ expanded: !!searching }}
          onPress={onSearch}
          style={({ pressed }) => [styles.round, searching && styles.active, pressed && styles.pressed]}
        >
          <IconSearch size={20} color={colors.heading} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingH, paddingTop: layout.headerTopMargin,
  },
  brand: { flexShrink: 1, gap: spacing.xxs },
  wordmarkRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  nameZh: { fontSize: 32, lineHeight: 40, letterSpacing: 2 },
  nameEn: { marginBottom: 2 },
  round: {
    width: layout.minTouchTarget, height: layout.minTouchTarget, borderRadius: layout.minTouchTarget / 2,
    backgroundColor: colors.surface, borderWidth: layout.border, borderColor: colors.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  active: { borderColor: colors.primary },
  pressed: { opacity: 0.6 },
});

export default BrandHeader;
