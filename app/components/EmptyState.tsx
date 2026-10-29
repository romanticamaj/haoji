import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { colors, layout, radius, spacing } from '../lib/theme';

// Centred icon-in-a-circle + title + next step (+ optional primary button). KEEPLACE
// src/components/EmptyState.tsx. The title states the situation; the description says what to do.
export function EmptyState({ icon, title, description, actionLabel, onAction }: {
  icon: ReactNode; title: string; description?: string; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconCircle}>{icon}</View>
      <AppText variant="section" color="heading" style={styles.center} accessibilityRole="header">{title}</AppText>
      {description ? <AppText variant="body" color="muted" style={styles.center}>{description}</AppText> : null}
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <AppText variant="cardTitle" color="onPrimary" style={styles.buttonLabel}>{actionLabel}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center', paddingHorizontal: layout.screenPaddingH * 2, paddingVertical: spacing.xxxl * 2,
    gap: spacing.md,
  },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surface,
    borderWidth: layout.border, borderColor: colors.outline,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
  },
  center: { textAlign: 'center' },
  button: {
    marginTop: spacing.lg, height: layout.buttonHeight, paddingHorizontal: spacing.xxxl,
    borderRadius: radius.button, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  buttonLabel: { fontWeight: '600' },
  pressed: { opacity: 0.8 },
});

export default EmptyState;
