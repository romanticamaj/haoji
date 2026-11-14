import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
// The bottom bar's 匯入 / 影片 actions pull in the native pickers; they are mocked per suite.
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  keepLocalCopy: jest.fn(),
  types: { audio: 'public.audio', video: 'public.movie' },
  isErrorWithCode: (e: any) => !!e && typeof e.code === 'string',
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
}));
jest.mock('react-native-image-picker', () => ({ launchImageLibrary: jest.fn() }));

import HomeScreen from '../HomeScreen';
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore, SavedSession } from '../../lib/store';

const mk = (id: string, t: number, title: string): SavedSession =>
  ({ id, createdAt: t, title, names: {}, unlocked: false, parts: [] });

const renderHome = async (seed: SavedSession[] = []) => {
  const store = createMemoryStore(seed);
  const utils = await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <StoreProvider store={store}>
        <NavigationContainer>
          <HomeScreen />
        </NavigationContainer>
      </StoreProvider>
    </SafeAreaProvider>,
  );
  return { store, ...utils };
};

test('shows empty state when no sessions', async () => {
  const { getByText } = await renderHome([]);
  await waitFor(() => getByText('還沒有任何會議'));
  getByText('按下方的「記下來」開始錄音，或匯入一段音檔。');
});

test('lists saved sessions newest-first', async () => {
  const { getByText } = await renderHome([mk('a', 1, '會議A'), mk('b', 2, '會議B')]);
  await waitFor(() => getByText('會議B'));
  getByText('會議A');
});

test('has the 記下來 record action, plus import and video in the bottom bar', async () => {
  const { getByLabelText } = await renderHome([]);
  await waitFor(() => getByLabelText('記下來：開始錄音'));
  getByLabelText('匯入音檔');
  getByLabelText('從相簿選影片');
});

test('search filters the list by title (case-insensitive) and shows a no-match message', async () => {
  const { getByText, getByPlaceholderText, queryByText, getByTestId } = await renderHome([
    mk('a', 1, '週會 Sprint'), mk('b', 2, '客戶訪談'),
  ]);
  await waitFor(() => getByText('客戶訪談'));
  // Search sits behind the round header button.
  await act(async () => { fireEvent.press(getByTestId('home-search-toggle')); });
  fireEvent.changeText(getByPlaceholderText('搜尋會議'), '週會');
  await waitFor(() => expect(queryByText('客戶訪談')).toBeNull()); // filtered out
  getByText('週會 Sprint');
  fireEvent.changeText(getByPlaceholderText('搜尋會議'), 'zzz');
  await waitFor(() => getByText('找不到「zzz」'));
});

test('swipe-delete hides the meeting at once and offers 復原; nothing is removed until it times out', async () => {
  jest.useFakeTimers();
  try {
    const { store, getByText, getByTestId, queryByText } = await renderHome([
      mk('a', 1, '會議A'),
      mk('b', 2, '會議B'),
    ]);
    await waitFor(() => getByText('會議A'));

    await act(async () => { fireEvent.press(getByTestId('session-a-delete')); });
    expect(queryByText('會議A')).toBeNull();
    getByText('已刪除「會議A」');
    getByText('會議B');                               // the other session stays
    expect(await store.get('a')).toBeTruthy();         // soft: still on the phone during the undo window

    await act(async () => { jest.advanceTimersByTime(10000); });
    await waitFor(async () => expect(await store.get('a')).toBeNull());
    expect(await store.get('b')).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});

test('復原 brings the meeting back and never deletes it', async () => {
  const { store, getByText, getByTestId, queryByText } = await renderHome([mk('a', 1, '會議A')]);
  await waitFor(() => getByText('會議A'));
  await act(async () => { fireEvent.press(getByTestId('session-a-delete')); });
  expect(queryByText('會議A')).toBeNull();

  await act(async () => { fireEvent.press(getByTestId('undo-delete')); });
  getByText('會議A');
  expect(queryByText('已刪除「會議A」')).toBeNull();
  expect(await store.get('a')).toBeTruthy();
});

// Delete is the one warning haptic (lib/haptics.ts).
test('deleting a meeting fires the warning haptic once', async () => {
  const trigger = require('react-native-haptic-feedback').default.trigger as jest.Mock;
  trigger.mockClear();
  const { getByText, getByTestId } = await renderHome([mk('a', 1, '會議A')]);
  await waitFor(() => getByText('會議A'));
  await act(async () => { fireEvent.press(getByTestId('session-a-delete')); });
  expect(trigger.mock.calls.map((c) => c[0])).toEqual(['notificationWarning']);
});
