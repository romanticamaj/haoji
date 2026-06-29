import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
const mockAnalyze = jest.fn().mockResolvedValue({ notes: '## 會議摘要\n摘要內容\n\n## 討論重點\n- 機密', model: 'm' });
jest.mock('../../lib/api', () => ({ analyze: (...a: any[]) => mockAnalyze(...a), getModels: jest.fn().mockResolvedValue({ ok: true, models: [], default: '' }) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(false), shareAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///c/', writeAsStringAsync: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { sessionId: 's' } }),
  useFocusEffect: (cb: any) => { const React = require('react'); React.useEffect(cb, []); },
}));
import ResultsScreen from '../ResultsScreen';
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore, SavedSession } from '../../lib/store';

const seed: SavedSession = { id: 's', createdAt: 1, title: 't', unlocked: true, names: {},
  transcript: { speakers: [], segments: [] } };

test('AI-analysis result survives switching tabs away and back', async () => {
  const store = createMemoryStore([seed]);
  const { getByText, findByText, queryByText } = await render(
    <StoreProvider store={store}><ResultsScreen /></StoreProvider>);
  fireEvent.press(await findByText('AI 分析'));
  fireEvent.press(await findByText('生成會議記錄'));
  await findByText(/摘要內容/);                 // generated, visible
  fireEvent.press(getByText('逐字稿'));          // switch away
  fireEvent.press(getByText('AI 分析'));          // switch back
  // analyze must NOT have been called again, and the notes are still there
  expect(mockAnalyze).toHaveBeenCalledTimes(1);
  await waitFor(() => getByText(/摘要內容/));
});
