import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { IconChevronRight } from './icons';
import { colors, radius, spacing } from '../lib/theme';
import { STAGES, type StageIndex } from '../lib/job';

// 上傳 → 排隊 → 辨識 → 整理, with the current step in sage and finished steps in primaryDark. Read out
// as one phrase: 「整理進度：辨識，第 3 步，共 4 步」.
export function StageRow({ current }: { current: StageIndex }) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`整理進度：${STAGES[current]}，第 ${current + 1} 步，共 ${STAGES.length} 步`}
    >
      {STAGES.map((label, i) => (
        <React.Fragment key={label}>
          {i > 0 && <IconChevronRight size={14} color={colors.hint} />}
          <View style={[styles.step, i === current && styles.current]}>
            <AppText
              variant="small"
              color={i === current ? 'onPrimary' : i < current ? 'primaryDark' : 'hint'}
              style={i === current && styles.bold}
            >
              {label}
            </AppText>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  step: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radius.round },
  current: { backgroundColor: colors.primary },
  bold: { fontWeight: '600' },
});

export default StageRow;
