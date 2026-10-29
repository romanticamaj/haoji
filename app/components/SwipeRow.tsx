import React, { useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText } from './AppText';
import { IconTrash } from './icons';
import { colors, radius } from '../lib/theme';

const DELETE_W = 96;

// Swipe a row left to reveal 刪除, then tap it. No confirm dialog: the caller soft-deletes and offers
// 復原 (UndoSnackbar), which is kinder than an "are you sure" and just as safe.
// Built on core RN PanResponder/Animated so it needs no native gesture library — the pan is only
// claimed for clearly-horizontal drags, so the vertical list scroll still works.
export default function SwipeRow({
  children, onDelete, deleteLabel, testID, style,
}: {
  children: React.ReactNode; onDelete: () => void; deleteLabel: string; testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const tx = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const startX = useRef(0);

  const snap = (open: boolean) => {
    openRef.current = open;
    Animated.timing(tx, { toValue: open ? -DELETE_W : 0, duration: 200, useNativeDriver: false }).start();
  };

  // Claim only clearly-horizontal drags — vertical moves pass through to the list scroll.
  const isHorizontal = (g: { dx: number; dy: number }) =>
    Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2;

  const pan = useRef(
    PanResponder.create({
      // CAPTURE phase: intercept the horizontal drag BEFORE the child Pressable (which grabs the
      // touch on press-down). Without this, wrapping a touchable swallows the swipe and nothing moves.
      onMoveShouldSetPanResponderCapture: (_e, g) => isHorizontal(g),
      onMoveShouldSetPanResponder: (_e, g) => isHorizontal(g),
      onPanResponderGrant: () => { startX.current = openRef.current ? -DELETE_W : 0; },
      // Once WE own the horizontal drag, don't let the parent list's native scroll reclaim it
      // mid-swipe — that termination snapped the row shut, so the delete could never stay revealed.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderMove: (_e, g) => {
        let next = startX.current + g.dx;
        if (next > 0) next = 0;                                   // don't drag past closed
        if (next < -DELETE_W - 40) next = -DELETE_W - 40;          // slight rubber-band past open
        tx.setValue(next);
      },
      onPanResponderRelease: (_e, g) => snap(startX.current + g.dx < -DELETE_W / 2),
      onPanResponderTerminate: () => snap(openRef.current),
    }),
  ).current;

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.deleteBg}>
        <Pressable
          testID={testID ? `${testID}-delete` : undefined}
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
          style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
          onPress={() => { snap(false); onDelete(); }}
        >
          <IconTrash size={20} color={colors.onPrimary} />
          <AppText variant="small" color="onPrimary" style={styles.deleteText}>刪除</AppText>
        </Pressable>
      </View>
      <Animated.View style={{ transform: [{ translateX: tx }] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  deleteBg: {
    position: 'absolute', top: 0, right: 0, bottom: 0, width: DELETE_W + radius.card,
    backgroundColor: colors.danger, borderRadius: radius.card, alignItems: 'flex-end',
  },
  deleteBtn: { flex: 1, width: DELETE_W, alignItems: 'center', justifyContent: 'center', gap: 4 },
  deleteText: { fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
