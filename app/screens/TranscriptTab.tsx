import React from 'react';
import {
  ScrollView, View, Text, TextInput, Pressable, Modal, Animated, StyleSheet,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { SavedSession } from '../lib/store';
import { mmss, nameOf, mergedParagraphs, applyTurnEdit, activeParagraph, transcriptPlainText } from '../lib/transcript';
import { IconCheck, IconCopy } from '../components/icons';
import { colors, radius, tabularNums, speakerColor } from '../lib/theme';

export default function TranscriptTab(
  { session, onUpdate, onRegenerate, onSeek, activeMs = 0 }:
  {
    session: SavedSession; onUpdate(s: SavedSession): void; onRegenerate?(): void;
    onSeek?(globalMs: number): void; activeMs?: number;
  },
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
  // Which paragraph is being edited INLINE (index into `turns`), plus its working draft text. Long-press
  // a paragraph to enter; 完成 writes the correction back into the transcript segments, 取消 discards.
  const [editIdx, setEditIdx] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState('');
  // Copy feedback: flips the copy button to a green ✓ 已複製 for ~1.6s after a tap.
  const [copied, setCopied] = React.useState(false);
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  const copyTranscript = () => {
    Clipboard.setString(transcriptPlainText(segs, session.names));
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1600);
  };

  const beginEdit = (i: number, text: string) => { setDraft(text); setEditIdx(i); };
  const commitEdit = (startIdx: number, endIdx: number) => {
    const next = applyTurnEdit(segs, startIdx, endIdx, draft.trim());
    onUpdate({ ...session, transcript: { ...(session.transcript!), segments: next } });
    setEditIdx(null);
  };

  // No transcript yet — either a saved draft the user hasn't generated, or a run that dropped
  // mid-transcription. Either way, offer to generate: it uploads the on-device parts to a fresh
  // backend session and runs the pipeline (interruptible — the recording stays saved until then).
  if (segs.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>還沒有逐字稿</Text>
        <Text style={styles.emptyHint}>
          {hasParts ? '這段錄音還沒有生成逐字稿。準備好了就點下面開始。' : '找不到可辨識的錄音檔。'}
        </Text>
        {hasParts && onRegenerate && (
          <Pressable style={styles.primary} onPress={onRegenerate} accessibilityRole="button">
            <Text style={styles.primaryText}>生成逐字稿</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const turns = React.useMemo(() => mergedParagraphs(segs), [segs]);
  // Paragraph currently being spoken (for follow-along highlight); -1 when not playing.
  const activeIdx = React.useMemo(() => activeParagraph(turns.map((t) => t.start), activeMs), [turns, activeMs]);

  // Follow the player: when the active paragraph changes (playback advancing OR a waveform scrub jump),
  // scroll it into view so the transcript tracks the audio position. Each turn reports its content-Y via
  // onLayout; we scroll only on index change (not every progress tick) so steady playback stays gentle.
  const scrollRef = React.useRef<ScrollView>(null);
  const turnY = React.useRef<Record<number, number>>({});
  React.useEffect(() => {
    if (activeIdx < 0) return;
    const y = turnY.current[activeIdx];
    if (y == null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 88), animated: true });
  }, [activeIdx]);
  // Count how many turns each speaker owns — shown in the rename sheet copy ("套用到 N 處").
  const turnCounts = React.useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of turns) c[t.speaker] = (c[t.speaker] ?? 0) + 1;
    return c;
  }, [segs]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={styles.wrap}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View style={styles.toolbar}>
          <Text style={styles.howto}>點段落跳到該處播放 · 長按可修改文字</Text>
          <Pressable
            testID="copy-transcript"
            style={[styles.copyChip, copied && styles.copyChipDone]}
            onPress={copyTranscript}
            accessibilityRole="button"
            accessibilityLabel="複製逐字稿"
          >
            {copied
              ? <><IconCheck size={14} color={colors.good} /><Text style={styles.copyChipDoneText}>已複製</Text></>
              : <><IconCopy size={14} color={colors.brand} /><Text style={styles.copyChipText}>複製</Text></>}
          </Pressable>
        </View>
        {turns.map((p, i) => {
          const idx = speakerIndex[p.speaker] ?? 0;
          const color = speakerColor(idx);
          const named = !!session.names[p.speaker];
          const display = nameOf(p.speaker, session.names);
          const initial = named ? display.trim().charAt(0) : String(idx + 1);
          const active = i === activeIdx;
          return (
            <View
              key={i}
              style={[styles.turn, active && styles.turnActive]}
              testID={active ? 'turn-active' : undefined}
              onLayout={(e) => { turnY.current[i] = e.nativeEvent.layout.y; }}
            >
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
              {editIdx === i ? (
                <View style={styles.editBox}>
                  <TextInput
                    testID={`edit-input-${i}`}
                    autoFocus
                    multiline
                    style={styles.editInput}
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="修改這段文字"
                    placeholderTextColor={colors.ink3}
                    scrollEnabled={false}
                  />
                  <View style={styles.editActions}>
                    <Pressable testID={`edit-cancel-${i}`} onPress={() => setEditIdx(null)} style={styles.editBtn} accessibilityRole="button">
                      <Text style={styles.editCancelText}>取消</Text>
                    </Pressable>
                    <Pressable testID={`edit-done-${i}`} onPress={() => commitEdit(p.startIdx, p.endIdx)} style={[styles.editBtn, styles.editDone]} accessibilityRole="button">
                      <Text style={styles.editDoneText}>完成</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  testID={`turn-body-${i}`}
                  onPress={() => onSeek?.(Math.round(p.start * 1000))}
                  onLongPress={() => beginEdit(i, p.text)}
                  delayLongPress={280}
                  accessibilityRole="button"
                  accessibilityLabel={`跳到 ${mmss(p.start)} 播放，長按可修改文字`}
                >
                  <Text style={[styles.body, active && styles.bodyActive]}>{p.text}</Text>
                </Pressable>
              )}
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

  // header row: gesture hint on the left, copy button on the right
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, paddingBottom: 2, gap: 8 },
  // teaches the two paragraph gestures (tap = seek, long-press = edit)
  howto: { flex: 1, fontSize: 11.5, color: colors.ink3 },
  copyChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.brandSoft },
  copyChipText: { fontSize: 13, fontWeight: '600', color: colors.brand },
  copyChipDone: { backgroundColor: colors.goodSoft },
  copyChipDoneText: { fontSize: 13, fontWeight: '600', color: colors.good },

  // turns
  turn: { paddingVertical: 12 },
  // follow-along highlight on the paragraph currently being played
  turnActive: {
    backgroundColor: colors.brandSoft, borderRadius: 12,
    marginHorizontal: -10, paddingHorizontal: 10, paddingVertical: 10,
  },
  turnHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  who: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  tc: { marginLeft: 'auto', fontSize: 11.5, color: colors.ink3 },
  body: { fontSize: 14, lineHeight: 22, color: colors.ink },
  bodyActive: { color: colors.brandPress },

  // inline editor (long-press a paragraph)
  editBox: {
    backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.brandSoft,
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10,
  },
  editInput: { fontSize: 14, lineHeight: 22, color: colors.ink, padding: 0, minHeight: 44, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
  editBtn: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 9 },
  editCancelText: { fontSize: 14, fontWeight: '600', color: colors.ink2 },
  editDone: { backgroundColor: colors.brand },
  editDoneText: { fontSize: 14, fontWeight: '700', color: '#fff' },

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
