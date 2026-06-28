import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import HomeScreen from '../HomeScreen';
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore, SavedSession } from '../../lib/store';

const mk = (id: string, t: number, title: string): SavedSession =>
  ({ id, createdAt: t, title, names: {}, unlocked: false });

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

test('has a 新錄音 button', async () => {
  const { getByText } = await renderHome([]);
  await waitFor(() => getByText('＋ 新錄音'));
});
