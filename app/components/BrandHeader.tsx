import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { IconSearch, IconServer } from './icons';
import { StatusDot } from './StatusDot';
import { brand, colors, layout, spacing } from '../lib/theme';
import type { Tone } from '../lib/serverStatus';

// Home's brand lock-up: 「好記 HAOJI」 + tagline on the left; on the right a round server-status button
// (opens Settings at 狀態) and a round outlined search button (KEEPLACE src/components/BrandHeader.tsx,
// GUIDELINE §3/§7). The brand lock-up reads as ONE accessibility header.
export function BrandHeader({ onSearch, searching, status }: {
  onSearch?: () => void;
  searching?: boolean;
  /** The server-status round button (Server icon + state badge), left of search. */
  status?: { tone: Tone; label: string; onPress(): void };
}) {
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
      <View style={styles.actions}>
        {status ? (
          <Pressable
            testID="home-status"
            accessibilityRole="button"
            accessibilityLabel={`主機狀態：${status.label}`}
            onPress={status.onPress}
            style={({ pressed }) => [styles.round, pressed && styles.pressed]}
          >
            {/* A server, with its state as a badge on the top-right corner of the glyph. */}
            <View testID="home-status-icon">
              <IconServer size={20} color={colors.heading} />
            </View>
            <View testID="home-status-badge" style={styles.badge} pointerEvents="none">
              <StatusDot tone={status.tone} badge />
            </View>
          </Pressable>
        ) : null}
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
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingH, paddingTop: layout.headerTopMargin,
  },
  brand: { flexShrink: 1, gap: spacing.xxs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wordmarkRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  nameZh: { fontSize: 32, lineHeight: 40, letterSpacing: 2 },
  nameEn: { marginBottom: 2 },
  round: {
    width: layout.minTouchTarget, height: layout.minTouchTarget, borderRadius: layout.minTouchTarget / 2,
    backgroundColor: colors.surface, borderWidth: layout.border, borderColor: colors.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  active: { borderColor: colors.primary },
  // Over the glyph's top-right corner: the 44 button centres a 20 icon, so its corner is ~12 in.
  badge: { position: 'absolute', top: 10, right: 10 },
  pressed: { opacity: 0.6 },
});

export default BrandHeader;
