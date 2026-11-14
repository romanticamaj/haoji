import React, { useRef } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useServerStatus } from '../hooks/useServerStatus';
import { forgetServer } from '../lib/server';
import { AppText } from '../components/AppText';
import { PrimaryButton, SecondaryButton, DangerButton } from '../components/Buttons';
import { StatusDot } from '../components/StatusDot';
import { IconChevronRight } from '../components/icons';
import { colors, layout, radius, spacing, tabularNums } from '../lib/theme';
import { version } from '../package.json';

export const SOURCE_URL = 'https://github.com/romanticamaj/haoji';

// 設定: which server this phone uses and how it is doing, what happens to recordings, and about.
// Four cards (spec §5.3 B): 主機 / 狀態 / 隱私 / 關於.
export default function SettingsScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const focus: 'status' | undefined = route?.params?.focus;
  const srv = useServerStatus();
  // Opened from Home's status badge: land on 狀態 as soon as its card has a position, once.
  const scrollRef = useRef<ScrollView>(null);
  const focused = useRef(false);
  const onStatusLayout = (y: number) => {
    if (focus !== 'status' || focused.current) return;
    focused.current = true;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.lg), animated: true });
  };
  const { summary } = srv;
  const unpaired = !srv.loading && !srv.base;

  const forget = () => {
    Alert.alert('中斷和這台主機的連線？', '手機上的錄音和會議記錄都會留著。', [
      { text: '取消', style: 'cancel' },
      { text: '中斷連線', style: 'destructive', onPress: () => forgetServer() },
    ]);
  };

  return (
    <ScrollView ref={scrollRef} style={styles.screen} contentContainerStyle={styles.content}>
      <Card title="主機">
        {unpaired ? (
          <>
            <AppText variant="cardTitle" color="heading">還沒連接主機</AppText>
            <AppText variant="body" color="muted">連接你自己的主機後，就能生成逐字稿和會議記錄。錄音不用連線也能用。</AppText>
            <PrimaryButton label="連接主機" onPress={() => nav.navigate('Pair')} style={styles.gapTop} />
          </>
        ) : (
          <>
            <AppText variant="cardTitle" color="heading" selectable numberOfLines={2}>{srv.base ?? ''}</AppText>
            {srv.latencyMs !== undefined && (
              <AppText variant="small" color="muted" style={tabularNums}>{`回應時間 ${srv.latencyMs} ms`}</AppText>
            )}
            <SecondaryButton label="重新配對" onPress={() => nav.navigate('Pair')} style={styles.gapTop} />
            {srv.server && <DangerButton label="中斷連線" onPress={forget} />}
          </>
        )}
      </Card>

      <Card title="狀態" testID="settings-card-status" onLayout={onStatusLayout}>
        <View
          style={styles.statusRow}
          accessible
          accessibilityLabel={`主機狀態：${srv.loading ? '正在確認…' : summary.label}`}
        >
          <StatusDot tone={summary.tone} size={10} />
          <AppText variant="cardTitle" color="heading">{srv.loading ? '正在確認…' : summary.label}</AppText>
        </View>
        {!srv.loading && summary.detail.map((line) => (
          <AppText key={line} variant="body" color="body" style={tabularNums}>{line}</AppText>
        ))}
      </Card>

      <Card title="隱私">
        <AppText variant="body" color="body">錄音只在處理時傳到你的主機，處理完就刪除。</AppText>
        <AppText variant="body" color="muted">逐字稿和會議記錄只存在這支手機上。</AppText>
      </Card>

      <Card title="關於">
        <AppText variant="body" color="body" style={tabularNums}>{`版本 ${version}`}</AppText>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="在 GitHub 看原始碼"
          onPress={() => { void Linking.openURL(SOURCE_URL).catch(() => {}); }}
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
          <AppText variant="body" color="primaryDark">在 GitHub 看原始碼</AppText>
          <IconChevronRight size={18} />
        </Pressable>
      </Card>
    </ScrollView>
  );
}

function Card({ title, children, testID, onLayout }: {
  title: string; children: React.ReactNode; testID?: string; onLayout?(y: number): void;
}) {
  return (
    <View style={styles.cardWrap} testID={testID} onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout.y) : undefined}>
      <AppText variant="section" color="heading" accessibilityRole="header" style={styles.cardTitle}>{title}</AppText>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: layout.screenPaddingH, paddingBottom: spacing.xxxl, paddingTop: spacing.lg },
  cardWrap: { marginBottom: spacing.xxl },
  cardTitle: { marginBottom: spacing.md },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, gap: spacing.sm,
    borderWidth: layout.border, borderColor: colors.outline,
  },
  gapTop: { marginTop: spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: layout.minTouchTarget },
  pressed: { opacity: 0.6 },
});
