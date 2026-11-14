import React from 'react';
import { StatusBar } from 'react-native';
import { AppStatusBar } from '../AppStatusBar';

// Edge-to-edge Android draws the status bar over the ivory canvas; without dark content the clock
// and icons were white-on-ivory (found on the Pixel 7 emulator).
test('status bar content is dark over the light canvas, translucent for edge-to-edge', () => {
  const bar = AppStatusBar() as React.ReactElement<React.ComponentProps<typeof StatusBar>>;
  expect(bar.type).toBe(StatusBar);
  expect(bar.props.barStyle).toBe('dark-content');
  expect(bar.props.translucent).toBe(true);
  expect(bar.props.backgroundColor).toBe('transparent');
});
