import React from 'react';
import {
  ScrollView, View, Text, TextInput, Pressable, Modal, Animated, StyleSheet,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SavedSession } from '../lib/store';
import { mmss, nameOf, mergedParagraphs } from '../lib/transcript';
import { colors, radius, tabularNums, speakerColor } from '../lib/theme';

export default function TranscriptTab(
  { session, onUpdate, onRegenerate }:
  { session: SavedSession; onUpdate(s: SavedSession): void; onRegenerate?(): void },
) {
  const segs = session.transcript?.segments ?? [];
  const speakers = session.transcript?.speakers ?? [];
  const hasParts = (session.parts?.length ?? 0) > 0;

  // Stable per-speaker color index: position in the transcript's speaker list. Any speaker seen in
  // segments but missing from `speakers` falls back to 0 (still valid, just shares the first hue).
  const speakerIndex = React.useMemo(() => {
    const m: Record<string, number> = {};
    speakers.forEach((sp, i) => { m[sp] = i; });
    return m;
  }, [speakers]);

  // Which speaker the rename sheet is editing (null = closed).
  const [editing, setEditing] = React.useState<string | null>(null);

  // Empty transcript (e.g. the backend dropped mid-transcription and never returned one) — offer a
  // full re-run rather than leaving the user stuck. Regeneration re-uploads the on-device parts to
  // a fresh backend session (the old one's parts are deleted after each attempt).
  if (segs.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>還沒有逐字稿</Text>
        <Text style={styles.emptyHint}>
          {hasParts ? '這次辨識沒有完成（後端可能中斷）。可以重新生成逐字稿再試一次。' : '找不到可辨識的錄音檔。'}
        </Text>
        {hasParts && onRegenerate && (
          <Pressable style={styles.primary} onPress={onRegenerate} accessibilityRole="button">
            <Text style={styles.primaryText}>重新生成逐字稿</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const turns = mergedParagraphs(segs);
  // Count how many turns each speaker owns — shown in the rename sheet copy ("套用到 N 處").
  const turnCounts = React.useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of turns) c[t.speaker] = (c[t.speaker] ?? 0) + 1;
    return c;
  }, [segs]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={styles.wrap}>
      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }}>
        {turns.map((p, i) => {
          const idx = speakerIndex[p.speaker] ?? 0;
          const color = speakerColor(idx);
          const named = !!session.names[p.speaker];
          const display = nameOf(p.speaker, session.names);
          const initial = named ? display.trim().charAt(0) : String(idx + 1);
          return (
            <View key={i} style={styles.turn}>
              <Pressable
                testID={`turn-head-${p.speaker}`}
                style={styles.turnHead}
                onPress={() => setEditing(p.speaker)}
                accessibilityRole="button"
                accessibilityLabel={`命名講者 ${display}`}
              >
                {named ? (
                  <>
                    <View style={[styles.av, { backgroundColor: color }]}>
                      <Text style={styles.avText}>{initial}</Text>
                    </View>
                    <Text style={styles.who}>{display}</Text>
                  </>
                ) : (
                  <View style={styles.chipUnset}>
                    <View style={[styles.av, styles.avUnset]}>
                      <Text style={styles.avText}>{initial}</Text>
                    </View>
                    <Text style={styles.chipUnsetText}>
                      講者 {idx + 1} <Text style={styles.chipUnsetHint}>· 點一下命名</Text>
                    </Text>
                  </View>
                )}
                <Text style={[styles.tc, tabularNums]}>{mmss(p.start)}</Text>
              </Pressable>
              <Text style={styles.body}>{p.text}</Text>
            </View>
          );
        })}
        {hasParts && onRegenerate && (
          <Pressable style={styles.regenFooter} onPress={onRegenerate} accessibilityRole="button">
            <Text style={styles.regenText}>重新生成逐字稿</Text>
          </Pressable>
        )}
      </ScrollView>

      {editing != null && (
        <RenameSheet
          speaker={editing}
          colorIndex={speakerIndex[editing] ?? 0}
          currentName={session.names[editing] || ''}
          turnCount={turnCounts[editing] ?? 0}
          onClose={() => setEditing(null)}
          onCommit={(name) => {
            onUpdate({ ...session, names: { ...session.names, [editing]: name.trim() } });
            setEditing(null);
          }}
        />
      )}
    </View>
  );
}

// Bottom sheet built on core RN (Modal + Animated) — no gesture-handler (incompatible with RN 0.81).
// Slides up on mount; scrim tap or 完成 dismisses. 完成 commits the typed name through onCommit.
function RenameSheet(
  { speaker, colorIndex, currentName, turnCount, onClose, onCommit }: {
    speaker: string;
    colorIndex: number;
    currentName: string;
    turnCount: number;
    onClose(): void;
    onCommit(name: string): void;
  },
) {
  const [value, setValue] = React.useState(currentName);
  const anim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [anim]);

  const color = speakerColor(colorIndex);
  const display = value.trim();
  const initial = display ? display.charAt(0) : String(colorIndex + 1);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [320, 0] });

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="關閉" testID="rename-scrim" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetKav}
          pointerEvents="box-none"
        >
          <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
            <View style={styles.grab} />
            <Text style={styles.sheetTitle}>命名這位講者</Text>
            <Text style={styles.sheetSub}>名字會自動套用到整份逐字稿與會議記錄</Text>

            <View style={styles.sheetField}>
              <View style={[styles.avLg, { backgroundColor: color }]}>
                <Text style={styles.avLgText}>{initial}</Text>
              </View>
              <TextInput
                testID={`rename-input-${speaker}`}
                autoFocus
                style={styles.sheetInput}
                value={value}
                onChangeText={setValue}
                placeholder="輸入名字"
                placeholderTextColor={colors.ink3}
                returnKeyType="done"
                onSubmitEditing={() => onCommit(value)}
              />
            </View>

            {turnCount > 0 && (
              <Text style={styles.applyAll}>套用到這位講者的所有段落（{turnCount} 處）</Text>
            )}

            <Pressable
              testID={`rename-done-${speaker}`}
              style={styles.sheetCta}
              onPress={() => onCommit(value)}
              accessibilityRole="button"
            >
              <Text style={styles.sheetCtaText}>完成</Text>
            </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.paper },
  scroll: { flex: 1, paddingHorizontal: 18 },

  emptyWrap: { flex: 1, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center', padding: 28 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  emptyHint: { color: colors.ink3, fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  primary: { backgroundColor: colors.brand, borderRadius: radius.control, paddingVertical: 13, paddingHorizontal: 28, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  regenFooter: { marginTop: 20, marginBottom: 8, paddingVertical: 10, alignItems: 'center' },
  regenText: { color: colors.brand, fontSize: 14, fontWeight: '600' },

  // turns
  turn: { paddingVertical: 12 },
  turnHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  who: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  tc: { marginLeft: 'auto', fontSize: 11.5, color: colors.ink3 },
  body: { fontSize: 14, lineHeight: 22, color: colors.ink },

  av: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  avText: { fontSize: 10, fontWeight: '700', color: '#fff' },

  // unnamed dashed pill
  chipUnset: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: colors.brandSoft, borderWidth: 1, borderStyle: 'dashed',
    borderColor: colors.speakerUnset, borderRadius: radius.pill, paddingVertical: 2, paddingLeft: 3, paddingRight: 10,
  },
  avUnset: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.speakerUnset },
  chipUnsetText: { color: colors.brand, fontSize: 12.5, fontWeight: '600' },
  chipUnsetHint: { color: colors.speakerUnsetText, fontWeight: '500' },

  // rename sheet
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,10,15,0.34)' },
  sheetKav: { justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
    paddingHorizontal: 22, paddingTop: 10, paddingBottom: 34,
  },
  grab: { width: 38, height: 5, borderRadius: 3, backgroundColor: colors.neutralSoft, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, textAlign: 'center', marginBottom: 4 },
  sheetSub: { fontSize: 12.5, color: colors.ink2, textAlign: 'center', marginBottom: 18, lineHeight: 18 },
  sheetField: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.chipBg, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 10,
  },
  avLg: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  avLgText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  sheetInput: { flex: 1, fontSize: 17, fontWeight: '600', color: colors.ink, padding: 0 },
  applyAll: { fontSize: 12.5, color: colors.ink2, paddingHorizontal: 4, paddingBottom: 16 },
  sheetCta: { height: 48, borderRadius: 14, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  sheetCtaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
