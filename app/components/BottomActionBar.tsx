import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { Touchable, dimOnPress } from './Buttons';
import { IconMic, type IconProps } from './icons';
import { colors, layout, spacing } from '../lib/theme';

// Home's bottom bar (KEEPLACE KeeplaceTabBar, GUIDELINE §7): a round sage centre ACTION labelled with
// the brand verb 「記下來」, flanked by plain icon+label items. Every item is an action — there is no
// tab navigator behind this.
type Side = { label: string; a11y: string; Icon: (p: IconProps) => React.ReactElement; onPress: () => void; testID?: string };

export function BottomActionBar({ left, right, onRecord }: { left?: Side; right?: Side; onRecord: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {left ? <SideItem {...left} /> : <View style={styles.item} />}
      <Touchable
        testID="home-record"
        accessibilityRole="button"
        accessibilityLabel="記下來：開始錄音"
        onPress={onRecord}
        style={styles.item}
        pressedStyle={null}
      >
        {({ pressed }) => (
          <>
            <View style={[styles.action, dimOnPress(pressed) && styles.pressedFill]}>
              <IconMic size={26} color={colors.onPrimary} strokeWidth={2} />
            </View>
            <AppText variant="tabLabel" color="muted" maxFontSizeMultiplier={1.3}>記下來</AppText>
          </>
        )}
      </Touchable>
      {right ? <SideItem {...right} /> : <View style={styles.item} />}
    </View>
  );
}

function SideItem({ label, a11y, Icon, onPress, testID }: Side) {
  return (
    <Touchable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={styles.item}
      pressedStyle={styles.pressed}
    >
      <View style={styles.iconBox}><Icon size={24} color={colors.muted} /></View>
      <AppText variant="tabLabel" color="muted" maxFontSizeMultiplier={1.3}>{label}</AppText>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'flex-end',
    minHeight: layout.bottomBarHeight, paddingTop: spacing.xs,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outline,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', minHeight: layout.minTouchTarget },
  // Same height as the round action so every icon shares one optical centre line.
  iconBox: { height: layout.bottomActionSize, alignItems: 'center', justifyContent: 'center' },
  action: {
    width: layout.bottomActionSize, height: layout.bottomActionSize, borderRadius: layout.bottomActionSize / 2,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  pressedFill: { opacity: 0.8 },
});

export default BottomActionBar;
