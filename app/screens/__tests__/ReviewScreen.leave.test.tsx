import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
const mockNavigate = jest.fn();
const mockPopToTop = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ replace: mockReplace, navigate: mockNavigate, popToTop: mockPopToTop }),
  useRoute: () => ({ params: { sessionId: 'sess1' } }),
  useFocusEffect: (cb: () => void) => { const React2 = require('react'); React2.useEffect(cb, [cb]); },
}));
jest.mock('react-native-audio-waveform', () => ({
  Waveform: () => null,
  useAudioPlayer: () => ({}),
}), { virtual: true });
jest.mock('react-native-share', () => ({ open: jest.fn() }));
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/doc', CachesDirectoryPath: '/cache',
  exists: async () => true, stat: async () => ({ size: 1000 }),
  copyFile: jest.fn(), unlink: jest.fn(),
}));

import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore, SavedSession } from '../../lib/store';
import ReviewScreen from '../ReviewScreen';

const session: SavedSession = {
  id: 'sess1', createdAt: 1, title: 't', unlocked: false, names: {},
  parts: [{ uri: 'haoji/sess1/part-0.wav', durationMs: 12000 }],
};

beforeEach(() => { jest.clearAllMocks(); });

/**
 * React Navigation 7 changed navigate(): it no longer returns to a screen already in the stack, it
 * pushes a new copy. Every "leave this flow" exit used navigate('Home'), so leaving stacked a SECOND
 * Home on top of the screen being left — the list grew a back button over its own title, offering to
 * return to the very screen the user had just chosen to leave.
 */
test('稍後再說 pops back to the list instead of pushing another one', async () => {
  const store = createMemoryStore([session]);
  const { getByText } = await render(
    <StoreProvider store={store}><ReviewScreen /></StoreProvider>);

  await waitFor(() => getByText('稍後再說'));
  fireEvent.press(getByText('稍後再說'));

  expect(mockPopToTop).toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalledWith('Home');
});
