import React, { useEffect, useRef, type ReactNode } from 'react';
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { colors, layout, radius, spacing } from '../lib/theme';
import { useAndroidBack } from '../hooks/useAndroidBack';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { duration, motion } from '../lib/motion';

// The one bottom sheet (KEEPLACE OptionSheet, GUIDELINE §7): the dim overlay fades in while only the
// sheet slides up (translateY, motion.sheet with the shared ease-out; instant under Reduce Motion).
// Surface with a 24 top radius, `section` title, safe-area padding. Tapping the backdrop closes it.
// statusBarTranslucent lets the overlay cover the status bar on Android too.
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
  const reduced = useReducedMotion();
  const { height } = useWindowDimensions();
  const rise = useRef(new Animated.Value(1)).current;   // 1 = below the screen, 0 = in place
  useEffect(() => {
    Animated.timing(rise, {
      toValue: 0, duration: duration('sheet', reduced), easing: motion.easing, useNativeDriver: true,
    }).start();
  }, [rise, reduced]);
  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="關閉" testID={scrimTestID} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kav}
          pointerEvents="box-none"
        >
          <Animated.View
            testID={testID}
            accessibilityViewIsModal
            style={[
              styles.sheet,
              { maxHeight, paddingBottom: insets.bottom + spacing.lg },
              { transform: [{ translateY: Animated.multiply(rise, height) }] },
            ]}
          >
            <AppText variant="section" color="heading" accessibilityRole="header">{title}</AppText>
            {subtitle ? <AppText variant="small" color="muted" style={styles.sub}>{subtitle}</AppText> : null}
            {children}
            {footer}
          </Animated.View>
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
