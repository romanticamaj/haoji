import React from 'react';
import { StatusBar } from 'react-native';

// One status bar for the whole app: dark content over the light ivory canvas. Translucent with a
// transparent background because Android runs edge-to-edge (the screens pad by the safe-area inset);
// on iOS only barStyle matters.
export function AppStatusBar() {
  return <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />;
}
