import { Easing } from 'react-native';

// The one motion language (spec §5.3 E, GUIDELINE §2.3): three durations and one ease-out curve.
// No springs. Under Reduce Motion every duration is 0, so things simply appear where they end up.
export const motion = {
  /** Press feedback, small state flips. */
  press: 120,
  /** Content changes: the tab underline, a row fading in, a progress bar growing. */
  content: 180,
  /** Sheets and panels opening or expanding (the mini player). */
  sheet: 240,
  easing: Easing.out(Easing.cubic),
} as const;

export type MotionKind = 'press' | 'content' | 'sheet';

export function duration(kind: MotionKind, reduced: boolean): number {
  return reduced ? 0 : motion[kind];
}
