import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { normalizeUrl, saveServer } from '../lib/server';
import { validateServer } from '../lib/serverStatus';
import { AppText } from '../components/AppText';
import { PrimaryButton } from '../components/Buttons';
import { ScreenHeader } from '../components/ScreenHeader';
import { IconCheck } from '../components/icons';
import { colors, layout, radius, spacing, typography } from '../lib/theme';

// How long 「已連上 …」 stays up before the screen closes by itself.
export const PAIRED_CLOSE_MS = 1200;

const hostOf = (url: string) => url.replace(/^https?:\/\//i, '');

// Connect this phone to a Haoji server. Reached from a haoji://pair link (fields prefilled), from
// Settings, from Onboarding, or from the 「連接主機」 prompts. Nothing is saved until the address
// proves to be a reachable Haoji server that accepts the key.
export default function PairScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const params: { url?: string; token?: string; error?: string } = route.params ?? {};

  const [url, setUrl] = useState(params.url ?? '');
  const [token, setToken] = useState(params.token ?? '');
  const [error, setError] = useState<string | null>(params.error ?? null);
  const [busy, setBusy] = useState(false);
  const [paired, setPaired] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const insets = useSafeAreaInsets();

  // A second link opened while this screen is up replaces what is in the fields.
  useEffect(() => {
    setUrl(params.url ?? '');
    setToken(params.token ?? '');
    setError(params.error ?? null);
    setPaired(null);
  }, [params.url, params.token, params.error]);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const connect = async () => {
    setError(null);
    setBusy(true);
    const t = token.trim() || undefined;
    const r = await validateServer(url, t);
    setBusy(false);
    if (!r.ok) { setError(r.message); return; }
    const base = normalizeUrl(url)!;
    await saveServer({ url: base, token: t, name: hostOf(base), pairedAt: Date.now() });
    setPaired(hostOf(base));
    closeTimer.current = setTimeout(close, PAIRED_CLOSE_MS);
  };

  // Leave once (the timer and 完成 can race): whichever comes first clears the other.
  const close = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = undefined; }
    if (nav.canGoBack?.()) nav.goBack();
    else nav.navigate('Home');
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="連接主機" onBack={() => { if (nav.canGoBack?.()) nav.goBack(); else nav.navigate('Home'); }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <AppText variant="screenTitle" color="heading" accessibilityRole="header">連接你的主機</AppText>
        <AppText variant="body" color="muted">在主機的管理頁「配對手機」，用相機掃 QR code 就會自動填好。</AppText>

        <View style={styles.field}>
          <AppText variant="cardTitle" color="heading">主機網址</AppText>
          <TextInput
            accessibilityLabel="主機網址"
            style={styles.input}
            value={url}
            onChangeText={(v) => { setUrl(v); setError(null); }}
            placeholder="http://100.64.0.5:7780"
            placeholderTextColor={colors.hint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => { if (url.trim() && !busy) void connect(); }}
            editable={!busy && !paired}
          />
        </View>

        <View style={styles.field}>
          <AppText variant="cardTitle" color="heading">配對碼（選填）</AppText>
          <TextInput
            accessibilityLabel="配對碼（選填）"
            style={styles.input}
            value={token}
            onChangeText={(v) => { setToken(v); setError(null); }}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            editable={!busy && !paired}
          />
        </View>

        {error ? (
          <AppText variant="body" color="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">{error}</AppText>
        ) : null}

        {paired ? (
          <View style={styles.done} accessibilityLiveRegion="polite">
            <IconCheck size={18} />
            <AppText variant="cardTitle" color="primaryDark">{`已連上 ${paired}`}</AppText>
          </View>
        ) : (
          <PrimaryButton
            label="連接"
            onPress={() => void connect()}
            disabled={!url.trim()}
            loading={busy}
            style={styles.button}
          />
        )}
      </ScrollView>
      {paired ? (
        // Pinned under the form once connected, so leaving never needs a scroll.
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <PrimaryButton label="完成" onPress={close} />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: layout.screenPaddingV, paddingBottom: spacing.xxxl, gap: spacing.lg },
  field: { gap: spacing.sm },
  input: {
    ...typography.body, lineHeight: undefined, color: colors.heading,
    backgroundColor: colors.surface, borderRadius: radius.input,
    borderWidth: layout.border, borderColor: colors.outline,
    paddingHorizontal: spacing.md, height: 48,
  },
  button: { marginTop: spacing.sm },
  done: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.buttonHeight },
  footer: { paddingHorizontal: layout.screenPaddingH, paddingTop: spacing.md, backgroundColor: colors.background },
});
