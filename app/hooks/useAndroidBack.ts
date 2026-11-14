import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';

/**
 * Handle the Android hardware back button. Return `true` when you handled it, `false` to let
 * navigation pop as usual. iOS has no hardware back, so nothing is registered there.
 *
 * Order comes from BackHandler itself: the most recently registered listener runs first. A Sheet
 * mounts after the screen it covers, so back closes the sheet before the screen ever sees it; then
 * Record asks before ending a take, and Processing goes Home.
 *
 * `enabled` turns the listener off (e.g. Record when nothing is being recorded). The handler is read
 * through a ref, so it always sees the latest state without re-registering — and without changing
 * its place in the order.
 */
export function useAndroidBack(handler: () => boolean, enabled: boolean = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (Platform.OS !== 'android' || !enabled) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => ref.current());
    return () => sub.remove();
  }, [enabled]);
}

export default useAndroidBack;
