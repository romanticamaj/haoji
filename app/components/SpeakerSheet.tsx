import React from 'react';
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, Animated,
  KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { SpeakerStat, mmss } from '../lib/transcript';
import { colors, radius, tabularNums, speakerColor } from '../lib/theme';

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
  const anim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [anim]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [520, 0] });
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
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="關閉" testID="speakers-scrim" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kav}
          pointerEvents="box-none"
        >
          <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
            <View style={styles.grab} />
            <Text style={styles.title}>這場會議的講者</Text>
            <Text style={styles.sub}>
              依說話時間排序 · 已命名 {named}/{stats.length} · 名字會套用到逐字稿與會議記錄
            </Text>

            <ScrollView
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            >
              {stats.map((s) => {
                const value = draft[s.speaker] ?? '';
                const shown = value.trim();
                const initial = shown ? shown.charAt(0) : String(s.index + 1);
                return (
                  <View key={s.speaker} style={styles.row} testID={`speaker-row-${s.speaker}`}>
                    <View style={[styles.av, { backgroundColor: shown ? speakerColor(s.index) : colors.speakerUnset }]}>
                      <Text style={styles.avText}>{initial}</Text>
                    </View>
                    <View style={styles.rowMain}>
                      <TextInput
                        testID={`speaker-input-${s.speaker}`}
                        style={styles.input}
                        value={value}
                        autoFocus={focus === s.speaker}
                        onChangeText={(t) => setDraft((d) => ({ ...d, [s.speaker]: t }))}
                        placeholder={`講者 ${s.index + 1}`}
                        placeholderTextColor={colors.ink3}
                        returnKeyType="done"
                      />
                      <Text style={[styles.meta, tabularNums]}>
                        說話 {mmss(Math.round(s.ms / 1000))} · {s.turns} 段
                      </Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <Pressable style={styles.cta} onPress={commit} accessibilityRole="button" testID="speakers-done">
              <Text style={styles.ctaText}>完成</Text>
            </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.paper, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 26, maxHeight: '82%',
  },
  grab: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: colors.hairline, marginBottom: 12 },
  title: { fontSize: 17, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 12.5, color: colors.ink3, marginTop: 4, marginBottom: 10 },
  list: { flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  av: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  avText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  rowMain: { flex: 1 },
  input: { fontSize: 15.5, color: colors.ink, paddingVertical: 2 },
  meta: { fontSize: 12, color: colors.ink3, marginTop: 1 },
  cta: { marginTop: 14, height: 50, borderRadius: radius.control, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
});
