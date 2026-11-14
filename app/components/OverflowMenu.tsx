import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { Sheet } from './Sheet';
import { colors, fontScale, layout, spacing } from '../lib/theme';

export type OverflowItem = {
  key: string;
  label: string;
  onPress(): void;
  icon?: ReactNode;
  /** Destructive — drawn in `danger` and kept last by the caller. */
  danger?: boolean;
  disabled?: boolean;
  /** Why it is disabled, in the user's words. */
  hint?: string;
};

// The `…` menu: the shared bottom Sheet with one row per action. A row closes the sheet first and then
// runs, so an action that opens its own sheet or dialog never stacks on top of this one.
export function OverflowMenu({ title, items, onClose }: { title: string; items: OverflowItem[]; onClose(): void }) {
  return (
    <Sheet title={title} onClose={onClose} testID="overflow-menu" scrimTestID="overflow-scrim">
      <View style={styles.list}>
        {items.map((it, i) => (
          <Pressable
            key={it.key}
            testID={`overflow-${it.key}`}
            disabled={it.disabled}
            onPress={() => { onClose(); it.onPress(); }}
            accessibilityRole="button"
            accessibilityLabel={it.label}
            accessibilityHint={it.disabled ? it.hint : undefined}
            accessibilityState={{ disabled: !!it.disabled }}
            style={({ pressed }) => [styles.row, i < items.length - 1 && styles.divider, pressed && styles.pressed]}
          >
            {it.icon ? <View style={styles.icon}>{it.icon}</View> : null}
            <View style={styles.text}>
              <AppText variant="body" color={it.disabled ? 'hint' : it.danger ? 'danger' : 'heading'} maxFontSizeMultiplier={fontScale.chrome}>
                {it.label}
              </AppText>
              {it.disabled && it.hint ? (
                <AppText variant="small" color="muted" maxFontSizeMultiplier={fontScale.chrome}>{it.hint}</AppText>
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: spacing.md },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52,
  },
  // Between rows only: the last row sits on the sheet's padding, not on a rule.
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.outline },
  icon: { width: 24, alignItems: 'center' },
  text: { flex: 1, paddingVertical: spacing.sm, minHeight: layout.minTouchTarget, justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});

export default OverflowMenu;
