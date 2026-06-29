import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { sessionId: 's' } }),
  useFocusEffect: (cb: any) => { const React = require('react'); React.useEffect(cb, []); },
}));
jest.mock('../../lib/api', () => ({ analyze: jest.fn(), getModels: jest.fn().mockResolvedValue({ ok: true, models: [], default: '' }) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(false), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
}));
import ResultsScreen from '../ResultsScreen';
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore, SavedSession } from '../../lib/store';

const s: SavedSession = { id: 's', createdAt: 1, title: 't', unlocked: false, names: {},
  notes: '## 會議摘要\n摘要\n\n## 討論重點\n- 機密', transcript: { speakers: [], segments: [] }, parts: [] };

test('tapping unlock reveals the locked detail', async () => {
  const store = createMemoryStore([s]);
  const { getByText, findByText, queryByText } = await render(
    <StoreProvider store={store}><ResultsScreen /></StoreProvider>);
  fireEvent.press(await findByText('AI 分析'));
  await waitFor(() => expect(queryByText('🔒 解鎖完整內容')).not.toBeNull());
  fireEvent.press(await findByText('🔒 解鎖完整內容'));
  await waitFor(() => getByText('複製'));
  await waitFor(() => expect(queryByText('🔒 解鎖完整內容')).toBeNull());
});
