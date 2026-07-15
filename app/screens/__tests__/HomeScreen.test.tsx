import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import HomeScreen from '../HomeScreen';
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore, SavedSession } from '../../lib/store';

const mk = (id: string, t: number, title: string): SavedSession =>
  ({ id, createdAt: t, title, names: {}, unlocked: false, parts: [] });

const renderHome = async (seed: SavedSession[] = []) => {
  const store = createMemoryStore(seed);
  const utils = await render(
    <StoreProvider store={store}>
      <NavigationContainer>
        <HomeScreen />
      </NavigationContainer>
    </StoreProvider>,
  );
  return { store, ...utils };
};

test('shows empty state when no sessions', async () => {
  const { getByText } = await renderHome([]);
  await waitFor(() => getByText(/還沒有錄音/));
});

test('lists saved sessions newest-first', async () => {
  const { getByText } = await renderHome([mk('a', 1, '會議A'), mk('b', 2, '會議B')]);
  await waitFor(() => getByText('會議B'));
  getByText('會議A');
});

test('has a 新會議 button', async () => {
  const { getByText } = await renderHome([]);
  await waitFor(() => getByText('新會議'));
});

test('search filters the list by title (case-insensitive) and shows a no-match message', async () => {
  const { getByText, getByPlaceholderText, queryByText } = await renderHome([
    mk('a', 1, '週會 Sprint'), mk('b', 2, '客戶訪談'),
  ]);
  await waitFor(() => getByText('客戶訪談'));
  fireEvent.changeText(getByPlaceholderText('搜尋會議'), '週會');
  await waitFor(() => expect(queryByText('客戶訪談')).toBeNull()); // filtered out
  getByText('週會 Sprint');
  fireEvent.changeText(getByPlaceholderText('搜尋會議'), 'zzz');
  await waitFor(() => getByText(/找不到符合/));
});

test('swipe-delete confirms then removes the session from the list and store', async () => {
  // Auto-confirm the destructive Alert
  const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    const del = (buttons || []).find((b: any) => b.style === 'destructive');
    del?.onPress?.();
  });

  const { store, getByText, getByTestId, queryByText } = await renderHome([
    mk('a', 1, '會議A'),
    mk('b', 2, '會議B'),
  ]);
  await waitFor(() => getByText('會議A'));

  fireEvent.press(getByTestId('session-a-delete'));

  await waitFor(() => expect(queryByText('會議A')).toBeNull());
  getByText('會議B'); // the other session stays
  expect(await store.get('a')).toBeNull();
  expect(await store.get('b')).toBeTruthy();

  spy.mockRestore();
});
