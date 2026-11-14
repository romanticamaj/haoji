import React, { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { AppText } from './AppText';
import { colors, fontScale, layout, radius, spacing } from '../lib/theme';

// KEEPLACE's button family (GUIDELINE §7). One filled primary per view; everything else is an outline.
type Common = {
  label: string;
  onPress(): void;
  disabled?: boolean;
  icon?: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/** 52 high, radius 18, sage fill. Loading swaps the label for a spinner. */
export function PrimaryButton({ label, onPress, disabled, icon, testID, accessibilityLabel, style, loading }: Common & { loading?: boolean }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [styles.primary, (disabled || loading) && styles.disabled, pressed && styles.pressedFill, style]}
    >
      {loading ? <ActivityIndicator color={colors.onPrimary} /> : (
        <>
          {icon}
          <AppText variant="cardTitle" color="onPrimary" style={styles.bold} maxFontSizeMultiplier={fontScale.chrome}>{label}</AppText>
        </>
      )}
    </Pressable>
  );
}

/** 48 high, radius 12, ivory fill + 1px outline, icon 18 + body label (settings `action`). */
export function SecondaryButton({ label, onPress, disabled, icon, testID, accessibilityLabel, style }: Common) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.secondary, disabled && styles.disabled, pressed && styles.pressedRow, style]}
    >
      {icon}
      <AppText variant="body" color="heading" maxFontSizeMultiplier={fontScale.chrome}>{label}</AppText>
    </Pressable>
  );
}

/** Outline, label + icon in `danger`; always the last thing on the page. */
export function DangerButton({ label, onPress, icon, testID, accessibilityLabel, style }: Common) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.secondary, styles.danger, pressed && styles.pressedRow, style]}
    >
      {icon}
      <AppText variant="body" color="danger" maxFontSizeMultiplier={fontScale.chrome}>{label}</AppText>
    </Pressable>
  );
}

/** 36 high, radius 18, surface + outline; selected = sage fill. Used in toolbars and choice rows. */
export function Chip({ label, onPress, disabled, icon, testID, accessibilityLabel, selected, style }: Common & { selected?: boolean }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      hitSlop={4}
      style={({ pressed }) => [styles.chip, selected && styles.chipOn, disabled && styles.disabled, pressed && styles.pressedRow, style]}
    >
      {icon}
      <AppText variant="cardTitle" color={selected ? 'onPrimary' : 'heading'} style={selected && styles.bold} maxFontSizeMultiplier={fontScale.chrome}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    height: layout.buttonHeight, borderRadius: radius.button, backgroundColor: colors.primary, paddingHorizontal: spacing.xxl,
  },
  secondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    height: 48, borderRadius: radius.input, backgroundColor: colors.background,
    borderWidth: layout.border, borderColor: colors.outline, paddingHorizontal: spacing.lg,
  },
  danger: { borderColor: colors.outline },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    height: layout.chipHeight, borderRadius: radius.chip, paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface, borderWidth: layout.border, borderColor: colors.outline,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  bold: { fontWeight: '600' },
  disabled: { opacity: 0.4 },
  pressedFill: { opacity: 0.8 },
  pressedRow: { opacity: 0.7 },
});
