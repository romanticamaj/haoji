import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Sheet } from './Sheet';
import { AppText } from './AppText';
import { IconFile, IconImage, IconChevronRight, type IconProps } from './icons';
import { colors, layout, radius, spacing } from '../lib/theme';

// Home's single 匯入 action opens this: pick an audio file or a video from the photo library.
// The caller owns the actual import (useImport); this sheet only chooses which picker to open.
export function ImportSheet({ onClose, onAudio, onVideo }: {
  onClose(): void;
  onAudio(): void;
  onVideo(): void;
}) {
  return (
    <Sheet title="匯入" subtitle="選一段要整理的錄音或影片。" onClose={onClose} testID="import-sheet">
      <View style={styles.list}>
        <Option
          Icon={IconFile}
          label="音檔"
          hint="手機或雲端硬碟裡的錄音。"
          a11y="匯入音檔"
          onPress={onAudio}
          testID="import-audio"
        />
        <Option
          Icon={IconImage}
          label="影片"
          hint="從相簿選影片，只取出聲音。"
          a11y="從相簿選影片"
          onPress={onVideo}
          testID="import-video"
        />
      </View>
    </Sheet>
  );
}

function Option({ Icon, label, hint, a11y, onPress, testID }: {
  Icon: (p: IconProps) => React.ReactElement; label: string; hint: string; a11y: string; onPress(): void; testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.icon}><Icon size={20} color={colors.heading} /></View>
      <View style={styles.text}>
        <AppText variant="cardTitle" color="heading">{label}</AppText>
        <AppText variant="small" color="muted">{hint}</AppText>
      </View>
      <IconChevronRight size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: layout.minTouchTarget + spacing.lg,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.card,
    backgroundColor: colors.background, borderWidth: layout.border, borderColor: colors.outline,
  },
  icon: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  text: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.7 },
});

export default ImportSheet;
