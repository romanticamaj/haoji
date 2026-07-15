import React from 'react';
import {
  View, Text, TextInput, Pressable, Modal, Animated, ScrollView, StyleSheet,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SavedSession } from '../lib/store';
import { KeywordRule, countMatches } from '../lib/keywords';
import { colors, radius } from '../lib/theme';

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
  const anim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => { Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start(); }, [anim]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [420, 0] });

  const setRule = (i: number, patch: Partial<KeywordRule>) =>
    setRules((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const addRow = () => setRules((rs) => [...rs, { from: '', to: '' }]);
  const removeRow = (i: number) => setRules((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== i) : rs));

  const apply = () => {
    const active = rules.filter((r) => r.from.trim().length > 0);
    if (active.length === 0) { setMsg('請先輸入要修正的字'); return; }
    const n = countMatches(session, active);
    if (n === 0) { setMsg('找不到可取代的字詞'); return; }
    onApply(active);
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="關閉" testID="kw-scrim" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
          <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
            <View style={styles.grab} />
            <Text style={styles.title}>修正關鍵字</Text>
            <Text style={styles.sub}>把辨識錯的字一次全部取代（逐字稿與會議記錄）</Text>

            <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
              {rules.map((r, i) => (
                <View key={i} style={styles.row}>
                  <TextInput
                    testID={`kw-from-${i}`}
                    style={styles.input}
                    value={r.from}
                    onChangeText={(t) => { setRule(i, { from: t }); setMsg(null); }}
                    placeholder="辨識成（錯）"
                    placeholderTextColor={colors.ink3}
                    autoCapitalize="none"
                  />
                  <Text style={styles.arrow}>→</Text>
                  <TextInput
                    testID={`kw-to-${i}`}
                    style={styles.input}
                    value={r.to}
                    onChangeText={(t) => setRule(i, { to: t })}
                    placeholder="正確字"
                    placeholderTextColor={colors.ink3}
                    autoCapitalize="none"
                    autoFocus={!!initialFrom && i === 0}
                  />
                  <Pressable onPress={() => removeRow(i)} hitSlop={8} style={styles.remove} accessibilityLabel="移除這組">
                    <Text style={styles.removeText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>

            <Pressable onPress={addRow} style={styles.add}><Text style={styles.addText}>＋ 新增一組</Text></Pressable>
            {msg && <Text style={styles.msg}>{msg}</Text>}

            <Pressable testID="kw-apply" style={styles.cta} onPress={apply} accessibilityRole="button">
              <Text style={styles.ctaText}>全部取代</Text>
            </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,16,14,0.35)' },
  kav: { justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30,
  },
  grab: { width: 38, height: 5, borderRadius: 3, backgroundColor: colors.neutralSoft, alignSelf: 'center', marginBottom: 14 },
  title: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 3 },
  sub: { fontSize: 12.5, color: colors.ink2, marginBottom: 14, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  input: {
    flex: 1, backgroundColor: colors.paper, borderRadius: radius.control, borderWidth: 1, borderColor: colors.hairline,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.ink,
  },
  arrow: { fontSize: 15, color: colors.ink3, fontWeight: '700' },
  remove: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontSize: 20, color: colors.ink3, lineHeight: 22 },
  add: { paddingVertical: 8, alignSelf: 'flex-start' },
  addText: { color: colors.brand, fontWeight: '600', fontSize: 14 },
  msg: { color: colors.brand, fontSize: 13, marginTop: 2, marginBottom: 4 },
  cta: { marginTop: 12, backgroundColor: colors.brand, borderRadius: radius.control, height: 50, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
