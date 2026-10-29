import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// iOS「減少動態效果」. Anything that moves for decoration (the breathing ring) must hold still when it
// is on (GUIDELINE §2.3). Starts false and settles after the first async read.
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { if (alive) setReduce(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduce(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduce;
}
