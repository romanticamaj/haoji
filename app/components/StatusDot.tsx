import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../lib/theme';
import type { Tone } from '../lib/serverStatus';

// The server's state in one 8 pt dot: sage = ready, peach = busy, a muted ring = offline / not paired.
// Decorative — the surrounding control carries the spoken label.
export function StatusDot({ tone, size = 8 }: { tone: Tone; size?: number }) {
  const shape = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View
      testID={`status-dot-${tone}`}
      style={[shape, tone === 'ready' ? styles.ready : tone === 'busy' ? styles.busy : styles.ring]}
    />
  );
}

const styles = StyleSheet.create({
  ready: { backgroundColor: colors.primary },
  busy: { backgroundColor: colors.accent },
  ring: { borderWidth: 1.5, borderColor: colors.muted, backgroundColor: 'transparent' },
});

export default StatusDot;
