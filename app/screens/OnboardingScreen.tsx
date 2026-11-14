import React, { useRef, useState } from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setOnboarded } from '../lib/store';
import { AppText } from '../components/AppText';
import { PrimaryButton, SecondaryButton } from '../components/Buttons';
import { IconAudioLines, IconLock, IconMic } from '../components/icons';
import { brand, colors, layout, spacing } from '../lib/theme';

type Card = { key: string; title: string; body: string; icon: React.ReactNode };

const CARDS: Card[] = [
  {
    key: 'what', title: brand.tagline,
    body: '錄下會議，好記會分出每個人說的話，整理成逐字稿和會議記錄。',
    icon: <IconAudioLines size={30} color={colors.primaryDark} />,
  },
  {
    key: 'where', title: '逐字稿在你自己的主機上處理，不經過任何雲端。',
    body: '你需要一台自己的主機。錄音只在處理時傳過去，處理完就刪除。',
    icon: <IconLock size={28} color={colors.primaryDark} />,
  },
  {
    key: 'pair', title: '連接你的主機',
    body: '掃主機管理頁上的 QR code，或輸入網址。之後也可以在「設定」連接。',
    icon: <IconMic size={28} color={colors.primaryDark} />,
  },
];

// First run, shown once (see shouldShowOnboarding in lib/store.ts). Three paging cards. Skipping is
// always fine — recording works without a server; only transcripts need one.
export default function OnboardingScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const list = useRef<FlatList<Card>>(null);
  const [page, setPage] = useState(0);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const p = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (p !== page) setPage(p);
  };
  const next = () => list.current?.scrollToIndex({ index: Math.min(page + 1, CARDS.length - 1), animated: true });

  const skip = async () => { await setOnboarded(); nav.navigate('Home'); };
  const pair = async () => { await setOnboarded(); nav.replace('Pair'); };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.lg }]}>
      <FlatList
        ref={list}
        data={CARDS}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyExtractor={(c) => c.key}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => (
          <View style={[styles.card, { width }]}>
            <View style={styles.iconCircle}>{item.icon}</View>
            <AppText variant="screenTitle" color="heading" style={styles.center} accessibilityRole="header">{item.title}</AppText>
            <AppText variant="body" color="muted" style={styles.center}>{item.body}</AppText>
            {item.key === 'pair' && (
              <View style={styles.cardActions}>
                <PrimaryButton label="掃描或輸入網址" onPress={() => void pair()} />
                <SecondaryButton label="先不用，直接錄音" onPress={() => void skip()} />
              </View>
            )}
          </View>
        )}
      />

      <View style={styles.dots} accessible accessibilityLabel={`第 ${page + 1} 頁，共 ${CARDS.length} 頁`}>
        {CARDS.map((c, i) => <View key={c.key} style={[styles.dot, i === page && styles.dotOn]} />)}
      </View>

      {/* The last card carries its own two choices; before it, page forward or skip. */}
      <View style={styles.actions}>
        {page < CARDS.length - 1 && (
          <>
            <PrimaryButton label="下一步" onPress={next} />
            <SecondaryButton label="略過" accessibilityLabel="略過介紹" onPress={() => void skip()} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  card: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: layout.screenPaddingH * 2, gap: spacing.lg },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surface,
    borderWidth: layout.border, borderColor: colors.outline, alignItems: 'center', justifyContent: 'center',
  },
  center: { textAlign: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.xxl },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.outline },
  dotOn: { backgroundColor: colors.primary },
  actions: { paddingHorizontal: layout.screenPaddingH, gap: spacing.md, minHeight: layout.buttonHeight + 48 + spacing.md },
  cardActions: { alignSelf: 'stretch', gap: spacing.md, marginTop: spacing.lg },
});
