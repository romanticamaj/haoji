import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { colors, layout, radius, spacing } from '../lib/theme';

export const UNDO_VISIBLE_MS = 10000;

// 「已刪除「週會」  復原」 — shown after a soft delete (KEEPLACE src/components/UndoSnackbar.tsx).
// `onTimeout` fires after 10 s; the caller makes the delete permanent then.
export function UndoSnackbar({ title, onUndo, onTimeout, bottom }: {
  title: string | null; onUndo: () => void; onTimeout: () => void; bottom: number;
}) {
  useEffect(() => {
    if (!title) return;
    const t = setTimeout(onTimeout, UNDO_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [title, onTimeout]);

  if (!title) return null;
  return (
    <View style={[styles.bar, { bottom }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <AppText variant="body" color="onPrimary" numberOfLines={1} style={styles.text}>已刪除「{title}」</AppText>
      <Pressable
        testID="undo-delete"
        accessibilityRole="button"
        accessibilityLabel={`復原「${title}」`}
        onPress={onUndo}
        hitSlop={8}
        style={styles.action}
      >
        <AppText variant="cardTitle" color="onPrimary" style={styles.actionText}>復原</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute', left: layout.screenPaddingH, right: layout.screenPaddingH,
    minHeight: layout.buttonHeight, borderRadius: radius.button, backgroundColor: colors.heading,
    flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg, paddingRight: spacing.xs,
  },
  text: { flex: 1 },
  action: { minHeight: layout.minTouchTarget, justifyContent: 'center', paddingHorizontal: spacing.md },
  actionText: { fontWeight: '600', textDecorationLine: 'underline' },
});

export default UndoSnackbar;
