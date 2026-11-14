import { BackHandler } from 'react-native';

// Jest runs the iOS build of BackHandler, which drops listeners. This spy keeps them so a test can
// press the Android hardware back: the newest listener runs first and `true` stops the chain —
// the same contract as BackHandler.android.js.
export function captureBack() {
  const listeners: (() => boolean | null | undefined)[] = [];
  const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, fn) => {
    listeners.push(fn);
    return { remove: () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
  });
  return {
    spy,
    get count() { return listeners.length; },
    /** Returns true when some listener handled it (otherwise navigation would pop / the app exit). */
    press(): boolean {
      for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i]()) return true;
      return false;
    },
  };
}
