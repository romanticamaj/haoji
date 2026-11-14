import React, { type ReactNode } from 'react';
import {
  ActivityIndicator, Platform, Pressable, StyleSheet,
  type PressableProps, type PressableStateCallbackType, type StyleProp, type ViewStyle,
} from 'react-native';
import { AppText } from './AppText';
import { colors, fontScale, layout, radius, spacing } from '../lib/theme';

// The one press feedback, per platform: Android gets the native ripple in `primarySoft` (what
// Android users expect from a touch), iOS fades. Read Platform.OS at render time so tests can switch.
export const RIPPLE = { color: colors.primarySoft, borderless: false } as const;
const PRESSED_DIM: ViewStyle = { opacity: 0.7 };
const CLIP: ViewStyle = { overflow: 'hidden' };

export type TouchableProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** iOS only: the look while pressed. Android shows the ripple instead. Default: opacity 0.7. */
  pressedStyle?: StyleProp<ViewStyle>;
};

export function Touchable({ style, pressedStyle = PRESSED_DIM, ...rest }: TouchableProps) {
  const android = Platform.OS === 'android';
  return (
    <Pressable
      {...rest}
      android_ripple={android ? RIPPLE : undefined}
      // overflow: hidden keeps the ripple inside rounded corners.
      style={({ pressed }: PressableStateCallbackType) => [style, android && CLIP, pressed && !android && pressedStyle]}
    />
  );
}

/** True while a press should dim a child by hand (iOS); Android's ripple already shows it. */
export const dimOnPress = (pressed: boolean) => pressed && Platform.OS !== 'android';

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
    <Touchable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={[styles.primary, (disabled || loading) && styles.disabled, style]}
      pressedStyle={styles.pressedFill}
    >
      {loading ? <ActivityIndicator color={colors.onPrimary} /> : (
        <>
          {icon}
          <AppText variant="cardTitle" color="onPrimary" style={styles.bold} maxFontSizeMultiplier={fontScale.chrome}>{label}</AppText>
        </>
      )}
    </Touchable>
  );
}

/** 48 high, radius 12, ivory fill + 1px outline, icon 18 + body label (settings `action`). */
export function SecondaryButton({ label, onPress, disabled, icon, testID, accessibilityLabel, style }: Common) {
  return (
    <Touchable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.secondary, disabled && styles.disabled, style]}
      pressedStyle={styles.pressedRow}
    >
      {icon}
      <AppText variant="body" color="heading" maxFontSizeMultiplier={fontScale.chrome}>{label}</AppText>
    </Touchable>
  );
}

/** Outline, label + icon in `danger`; always the last thing on the page. */
export function DangerButton({ label, onPress, icon, testID, accessibilityLabel, style }: Common) {
  return (
    <Touchable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[styles.secondary, styles.danger, style]}
      pressedStyle={styles.pressedRow}
    >
      {icon}
      <AppText variant="body" color="danger" maxFontSizeMultiplier={fontScale.chrome}>{label}</AppText>
    </Touchable>
  );
}

/** No fill, no outline: a `danger` label in a 44 pt target. For a quiet destructive action inside a card. */
export function DangerTextButton({ label, onPress, testID, accessibilityLabel, style }: Common) {
  return (
    <Touchable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[styles.text, style]}
      pressedStyle={styles.pressedRow}
    >
      <AppText variant="body" color="danger" maxFontSizeMultiplier={fontScale.chrome}>{label}</AppText>
    </Touchable>
  );
}

/** 36 high, radius 18, surface + outline; selected = sage fill. Used in toolbars and choice rows. */
export function Chip({ label, onPress, disabled, icon, testID, accessibilityLabel, selected, style }: Common & { selected?: boolean }) {
  return (
    <Touchable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      hitSlop={4}
      style={[styles.chip, selected && styles.chipOn, disabled && styles.disabled, style]}
      pressedStyle={styles.pressedRow}
    >
      {icon}
      <AppText variant="cardTitle" color={selected ? 'onPrimary' : 'heading'} style={selected && styles.bold} maxFontSizeMultiplier={fontScale.chrome}>{label}</AppText>
    </Touchable>
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
  text: { minHeight: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
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
