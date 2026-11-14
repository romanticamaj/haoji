import React, { type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { colors, layout, radius, spacing } from '../lib/theme';
import { useAndroidBack } from '../hooks/useAndroidBack';

// The one bottom sheet (KEEPLACE OptionSheet, GUIDELINE §7): slides up over the dim overlay, surface
// with a 24 top radius, `section` title, safe-area padding. Tapping the backdrop closes it.
export function Sheet({ title, subtitle, onClose, children, footer, testID, scrimTestID, maxHeight = '82%' }: {
  title: string;
  subtitle?: string;
  onClose(): void;
  children: ReactNode;
  /** Pinned under the content (e.g. the 完成 button), so a long list never pushes it off-screen. */
  footer?: ReactNode;
  testID?: string;
  scrimTestID?: string;
  maxHeight?: `${number}%` | number;
}) {
  const insets = useSafeAreaInsets();
  // Android back closes the sheet first (registered after the screen, so it runs before it). The
  // Modal's onRequestClose covers the native path; this covers the BackHandler chain.
  useAndroidBack(() => { onClose(); return true; });
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="關閉" testID={scrimTestID} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kav}
          pointerEvents="box-none"
        >
          <View
            testID={testID}
            accessibilityViewIsModal
            style={[styles.sheet, { maxHeight, paddingBottom: insets.bottom + spacing.lg }]}
          >
            <AppText variant="section" color="heading" accessibilityRole="header">{title}</AppText>
            {subtitle ? <AppText variant="small" color="muted" style={styles.sub}>{subtitle}</AppText> : null}
            {children}
            {footer}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
    paddingTop: spacing.xl, paddingHorizontal: layout.screenPaddingH,
  },
  sub: { marginTop: spacing.xs, marginBottom: spacing.sm },
});

export default Sheet;
