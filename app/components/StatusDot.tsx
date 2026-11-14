import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../lib/theme';
import type { Tone } from '../lib/serverStatus';

// The server's state in one 8 pt dot: sage = ready, peach = busy, a muted ring = offline / not paired.
// Decorative — the surrounding control carries the spoken label.
//
// `badge`: the dot sits on top of an icon (Home's server button), so a filled dot gets a 1.5 pt
// `surface` ring to lift it off the stroke, and a hollow one is filled with `surface`.
export function StatusDot({ tone, size = 8, badge = false }: { tone: Tone; size?: number; badge?: boolean }) {
  const shape = { width: size, height: size, borderRadius: size / 2 };
  const filled = tone === 'ready' || tone === 'busy';
  return (
    <View
      testID={`status-dot-${tone}`}
      style={[
        shape,
        tone === 'ready' ? styles.ready : tone === 'busy' ? styles.busy : styles.ring,
        badge && (filled ? styles.badgeRing : styles.badgeHollow),
      ]}
    />
  );
}

const styles = StyleSheet.create({
  ready: { backgroundColor: colors.primary },
  busy: { backgroundColor: colors.accent },
  ring: { borderWidth: 1.5, borderColor: colors.muted, backgroundColor: 'transparent' },
  badgeRing: { borderWidth: 1.5, borderColor: colors.surface },
  badgeHollow: { backgroundColor: colors.surface },
});

export default StatusDot;
