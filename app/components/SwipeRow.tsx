import React, { useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, Pressable, View, Alert } from 'react-native';
import { colors } from '../lib/theme';

const DELETE_W = 96;

// Swipe a row left to reveal a red "刪除" button (iOS Voice-Memos style), then tap it to delete
// (with a confirm). Built on core RN PanResponder/Animated so it needs no native gesture library —
// the pan is only claimed for clearly-horizontal drags, so the vertical list scroll still works.
export default function SwipeRow({
  children, onDelete, confirmTitle, testID,
}: { children: React.ReactNode; onDelete: () => void; confirmTitle: string; testID?: string }) {
  const tx = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const startX = useRef(0);

  const snap = (open: boolean) => {
    openRef.current = open;
    Animated.spring(tx, { toValue: open ? -DELETE_W : 0, useNativeDriver: false, bounciness: 0 }).start();
  };

  // Claim only clearly-horizontal drags — vertical moves pass through to the FlatList scroll.
  const isHorizontal = (g: { dx: number; dy: number }) =>
    Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2;

  const pan = useRef(
    PanResponder.create({
      // CAPTURE phase: intercept the horizontal drag BEFORE the child Pressable (which grabs the
      // touch on press-down). Without this, wrapping a touchable swallows the swipe and nothing moves.
      onMoveShouldSetPanResponderCapture: (_e, g) => isHorizontal(g),
      onMoveShouldSetPanResponder: (_e, g) => isHorizontal(g),
      onPanResponderGrant: () => { startX.current = openRef.current ? -DELETE_W : 0; },
      // Once WE own the horizontal drag, don't let the parent SectionList's native scroll reclaim it
      // mid-swipe — that termination was firing onPanResponderTerminate and snapping the row shut, so
      // the delete could never stay revealed ("一直彈回去").
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

  const confirmDelete = () => {
    Alert.alert(confirmTitle, '刪除後無法復原，確定要刪除嗎？', [
      { text: '取消', style: 'cancel', onPress: () => snap(false) },
      { text: '刪除', style: 'destructive', onPress: () => { snap(false); onDelete(); } },
    ]);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.deleteBg}>
        <Pressable
          testID={testID ? `${testID}-delete` : undefined}
          accessibilityRole="button"
          accessibilityLabel="刪除"
          style={styles.deleteBtn}
          onPress={confirmDelete}
        >
          <Text style={styles.deleteText}>刪除</Text>
        </Pressable>
      </View>
      <Animated.View style={[styles.fg, { transform: [{ translateX: tx }] }]} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  deleteBg: { position: 'absolute', top: 0, right: 0, bottom: 0, width: DELETE_W, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  deleteBtn: { flex: 1, width: DELETE_W, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  fg: { backgroundColor: colors.card },
});
