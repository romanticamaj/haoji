import React from 'react';
import { View, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SavedSession } from '../lib/store';
import { KeywordRule, countMatches } from '../lib/keywords';
import { colors, layout, radius, spacing, typography } from '../lib/theme';
import { AppText } from './AppText';
import { Sheet } from './Sheet';
import { PrimaryButton } from './Buttons';
import { IconClose } from './icons';

// Batch keyword fix-up: ASR mis-hears a term the same way every time (e.g. "cloud" → "Claude"), so the
// user lists wrong→right pairs here and taps 全部取代 to replace every occurrence across the transcript
// AND the notes at once. Bottom sheet on core RN (Modal + Animated), matching the rename/title sheets.
export default function KeywordSheet(
  { session, onClose, onApply, initialFrom }:
  { session: SavedSession; onClose(): void; onApply(rules: KeywordRule[]): void; initialFrom?: string },
) {
  // When opened from a text selection, seed the first row's "wrong" word so the user only types the fix.
  const [rules, setRules] = React.useState<KeywordRule[]>(
    initialFrom ? [{ from: initialFrom, to: '' }] : [{ from: '', to: '' }, { from: '', to: '' }],
  );
  const [msg, setMsg] = React.useState<string | null>(null);

  const setRule = (i: number, patch: Partial<KeywordRule>) =>
    setRules((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const addRow = () => setRules((rs) => [...rs, { from: '', to: '' }]);
  const removeRow = (i: number) => setRules((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== i) : rs));

  const apply = () => {
    const active = rules.filter((r) => r.from.trim().length > 0);
    if (active.length === 0) { setMsg('先輸入辨識錯的字。'); return; }
    const n = countMatches(session, active);
    if (n === 0) { setMsg('逐字稿和會議記錄裡都找不到這個字。'); return; }
    onApply(active);
  };

  return (
    <Sheet
      title="修正關鍵字"
      subtitle="辨識錯的字，一次在逐字稿和會議記錄裡全部換掉。"
      onClose={onClose}
      scrimTestID="kw-scrim"
      footer={<PrimaryButton testID="kw-apply" label="全部取代" onPress={apply} style={styles.cta} />}
    >
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {rules.map((r, i) => (
          <View key={i} style={styles.row}>
            <TextInput
              testID={`kw-from-${i}`}
              style={styles.input}
              value={r.from}
              onChangeText={(t) => { setRule(i, { from: t }); setMsg(null); }}
              placeholder="辨識成"
              placeholderTextColor={colors.hint}
              autoCapitalize="none"
              accessibilityLabel={`第 ${i + 1} 組：辨識錯的字`}
            />
            <AppText variant="body" color="muted">→</AppText>
            <TextInput
              testID={`kw-to-${i}`}
              style={styles.input}
              value={r.to}
              onChangeText={(t) => setRule(i, { to: t })}
              placeholder="正確的字"
              placeholderTextColor={colors.hint}
              autoCapitalize="none"
              autoFocus={!!initialFrom && i === 0}
              accessibilityLabel={`第 ${i + 1} 組：正確的字`}
            />
            <Pressable onPress={() => removeRow(i)} hitSlop={8} style={styles.remove} accessibilityRole="button" accessibilityLabel={`移除第 ${i + 1} 組`}>
              <IconClose size={18} color={colors.muted} />
            </Pressable>
          </View>
        ))}
      </ScrollView>

      <Pressable onPress={addRow} style={styles.add} accessibilityRole="button" hitSlop={8}>
        <AppText variant="cardTitle" color="primaryDark">＋ 新增一組</AppText>
      </Pressable>
      {msg && <AppText variant="small" color="danger">{msg}</AppText>}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 260, marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  input: {
    flex: 1, ...typography.body, lineHeight: undefined, color: colors.heading,
    height: 48, paddingHorizontal: spacing.md, borderRadius: radius.input,
    backgroundColor: colors.background, borderWidth: layout.border, borderColor: colors.outline,
  },
  remove: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  add: { minHeight: layout.minTouchTarget, justifyContent: 'center', alignSelf: 'flex-start' },
  cta: { marginTop: spacing.lg },
});
