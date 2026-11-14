import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText } from './AppText';
import { PrimaryButton, SecondaryButton } from './Buttons';
import { spacing } from '../lib/theme';
import type { Gate } from '../lib/serverStatus';

export const CONNECT_LABEL = '連接主機後就能生成逐字稿';
export const OFFLINE_NOTE = '主機沒有回應，錄音還在手機上。';

// The one "make a transcript" action, aware of the server (lib/serverStatus transcribeGate):
//   ok       → the normal primary button
//   unpaired → a secondary 「連接主機後就能生成逐字稿」 that opens Pair
//   offline  → the primary, disabled, with a line saying the recording is safe
export function TranscribeButton({ gate, label, onPress, onConnect, disabled, loading, style, testID }: {
  gate: Gate;
  label: string;
  onPress(): void;
  onConnect(): void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  if (gate === 'unpaired') {
    return <SecondaryButton label={CONNECT_LABEL} onPress={onConnect} style={style} testID={testID} />;
  }
  const offline = gate === 'offline';
  return (
    <View style={[styles.wrap, style]}>
      <PrimaryButton label={label} onPress={onPress} disabled={disabled || offline} loading={loading} testID={testID} />
      {offline ? (
        <AppText variant="small" color="muted" style={styles.note} accessibilityLiveRegion="polite">{OFFLINE_NOTE}</AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: spacing.sm },
  note: { textAlign: 'center' },
});

export default TranscribeButton;
