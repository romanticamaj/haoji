import { getStateFromPath, type LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation';
import { parsePairLink } from './pairLink';

// Deep links. Only haoji://pair is routed: it opens the Pair screen prefilled (or explaining why the
// link is bad). haoji://e2e/… is the simulator test hook, consumed natively by E2EHooks.swift in
// AppDelegate before React Native sees it — the filter keeps it out of navigation regardless.
export const isE2EUrl = (url: string) => /^haoji:\/\/e2e(\/|\?|$)/i.test(url);

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['haoji://'],
  filter: (url) => !isE2EUrl(url),
  config: { screens: { Pair: 'pair' } },
  getStateFromPath(path, options) {
    if (/^\/?pair(\/|\?|$)/i.test(path)) {
      // Parse with our own validator, never trusting the raw query: only plain http(s) addresses get
      // into the address field.
      const r = parsePairLink(`haoji://${path.replace(/^\//, '')}`);
      const params = 'error' in r ? { error: r.error } : r;
      // Home underneath, so back (or a successful pairing) lands somewhere sensible on a cold start.
      return { routes: [{ name: 'Home' }, { name: 'Pair', params }] } as any;
    }
    return getStateFromPath(path, options);
  },
};
