// One haptic language for both platforms (spec §5.3 E): light / success / warning, mapped from what
// just happened rather than chosen per call site. Never fire on scroll or per progress tick.
//
// The feedback is decoration, so it must never break anything: the native module is required
// lazily (a missing TurboModule throws at import) and every call swallows its own errors.

export type HapticEvent = 'recordStart' | 'recordStop' | 'pause' | 'tab' | 'ready' | 'delete';

export const HAPTIC_MAP: Record<HapticEvent, 'impactLight' | 'notificationSuccess' | 'notificationWarning'> = {
  recordStart: 'impactLight',
  pause: 'impactLight',
  tab: 'impactLight',
  recordStop: 'notificationSuccess',
  ready: 'notificationSuccess',
  delete: 'notificationWarning',
};

type Trigger = (type: string, options?: { enableVibrateFallback?: boolean; ignoreAndroidSystemSettings?: boolean }) => void;

let trigger: Trigger | null | undefined;
function load(): Trigger | null {
  if (trigger !== undefined) return trigger;
  try {
    const m = require('react-native-haptic-feedback');
    const t = m?.default?.trigger ?? m?.trigger;
    trigger = typeof t === 'function' ? (t as Trigger) : null;
  } catch {
    trigger = null;
  }
  return trigger ?? null;
}

export function haptic(event: HapticEvent): void {
  const t = load();
  if (!t) return;
  try {
    // No vibrate fallback: a buzz on phones without a Taptic engine is worse than nothing.
    t(HAPTIC_MAP[event], { enableVibrateFallback: false, ignoreAndroidSystemSettings: false });
  } catch { /* decoration only */ }
}
