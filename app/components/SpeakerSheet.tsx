import React from 'react';
import { View, TextInput, ScrollView, StyleSheet } from 'react-native';
import { SpeakerStat, mmss } from '../lib/transcript';
import { colors, layout, radius, spacing, tabularNums, speakerColor, typography } from '../lib/theme';
import { AppText } from './AppText';
import { Sheet } from './Sheet';
import { PrimaryButton } from './Buttons';

/// Every speaker in the meeting, in one place, each renameable where it stands.
///
/// Diarisation regularly finds a dozen speakers. Naming them one paragraph at a time meant scrolling
/// the transcript hunting for a voice you had not met yet, with no way to tell who mattered. Here
/// they are ranked by how long each one actually spoke, so the people who carried the meeting are at
/// the top and the one-line strays sink.
export default function SpeakerSheet(
  { stats, names, onClose, onCommit, focus }: {
    stats: SpeakerStat[];
    names: Record<string, string>;
    onClose(): void;
    /// Called once with every change, so naming eight people is one write, not eight.
    onCommit(next: Record<string, string>): void;
    /// Speaker to focus when opened from a paragraph header.
    focus?: string | null;
  },
) {
  const [draft, setDraft] = React.useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const s of stats) d[s.speaker] = names[s.speaker] ?? '';
    return d;
  });
  const named = stats.filter((s) => (draft[s.speaker] ?? '').trim()).length;

  const commit = () => {
    const next = { ...names };
    for (const [sp, v] of Object.entries(draft)) {
      const t = v.trim();
      // An emptied field REMOVES the name rather than storing "", so the speaker goes back to
      // 講者 N instead of rendering as a blank label.
      if (t) next[sp] = t; else delete next[sp];
    }
    onCommit(next);
  };

  return (
    <Sheet
      title="這場會議的講者"
      subtitle={`依說話時間排序，已命名 ${named}/${stats.length}。名字會用在逐字稿和會議記錄裡。`}
      onClose={onClose}
      scrimTestID="speakers-scrim"
      footer={<PrimaryButton testID="speakers-done" label="完成" onPress={commit} style={styles.cta} />}
    >
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {stats.map((s, i) => {
          const value = draft[s.speaker] ?? '';
          const shown = value.trim();
          const initial = shown ? shown.charAt(0) : String(s.index + 1);
          return (
            <View key={s.speaker} style={[styles.row, i < stats.length - 1 && styles.divider]} testID={`speaker-row-${s.speaker}`}>
              <View style={[styles.av, { backgroundColor: shown ? speakerColor(s.index) : colors.accent }]}>
                <AppText variant="cardTitle" color="onPrimary" style={styles.avText}>{initial}</AppText>
              </View>
              <View style={styles.rowMain}>
                <TextInput
                  testID={`speaker-input-${s.speaker}`}
                  style={styles.input}
                  value={value}
                  autoFocus={focus === s.speaker}
                  onChangeText={(t) => setDraft((d) => ({ ...d, [s.speaker]: t }))}
                  placeholder={`講者 ${s.index + 1}`}
                  placeholderTextColor={colors.hint}
                  returnKeyType="done"
                  accessibilityLabel={`講者 ${s.index + 1} 的名字`}
                />
                <AppText variant="small" color="muted" style={tabularNums}>
                  說話 {mmss(Math.round(s.ms / 1000))} · {s.turns} 段
                </AppText>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { flexShrink: 1, marginTop: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm,
  },
  // Between rows only, never under the last one.
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.outline },
  av: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avText: { fontWeight: '600' },
  rowMain: { flex: 1 },
  input: {
    ...typography.body, lineHeight: undefined, color: colors.heading,
    height: 40, paddingHorizontal: spacing.md, borderRadius: radius.input,
    backgroundColor: colors.background, borderWidth: layout.border, borderColor: colors.outline, marginBottom: 2,
  },
  cta: { marginTop: spacing.lg },
});
