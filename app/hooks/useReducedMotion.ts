import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// iOS「減少動態效果」/ Android "Remove animations". Pair with lib/motion.ts duration(kind, reduced):
// anything that moves must go instant when this is on (GUIDELINE §2.3). Starts false and settles
// after the first async read.
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { if (alive) setReduce(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduce(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduce;
}

export default useReducedMotion;
