import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
const notes = '## 會議摘要\n摘要內容\n\n## 討論重點\n- 機密';
const mockAnalyzeBg = jest.fn().mockResolvedValue(undefined);
const mockGetSession = jest.fn().mockResolvedValue({ status: 'done', pct: 1, message: '完成', notes_status: 'done', notes });
jest.mock('../../lib/api', () => ({
  analyze: jest.fn(),
  analyzeInBackground: (...a: any[]) => mockAnalyzeBg(...a),
  getSession: (...a: any[]) => mockGetSession(...a),
  getModels: jest.fn().mockResolvedValue({ ok: true, models: [], default: '' }),
}));
jest.mock('@react-native-clipboard/clipboard', () => ({ setString: jest.fn() }));
jest.mock('react-native-share', () => ({ open: jest.fn().mockResolvedValue({}) }));
jest.mock('react-native-fs', () => ({ DocumentDirectoryPath: '/doc', writeFile: jest.fn().mockResolvedValue(undefined), unlink: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { sessionId: 's' } }),
  useNavigation: () => ({ navigate: jest.fn(), replace: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: (cb: any) => { const React = require('react'); React.useEffect(cb, []); },
}));
import ResultsScreen from '../ResultsScreen';
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore, SavedSession } from '../../lib/store';

const seed: SavedSession = { id: 's', createdAt: 1, title: 't', unlocked: true, names: {},
  transcript: { speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 1, speaker: 'SPEAKER_00', text: '嗨' }] }, parts: [] };

test('AI-analysis result survives switching tabs away and back', async () => {
  const store = createMemoryStore([seed]);
  const { getByText, findByText, queryByText } = await render(
    <StoreProvider store={store}><ResultsScreen /></StoreProvider>);
  fireEvent.press(await findByText('AI 分析'));
  fireEvent.press(await findByText('生成會議記錄'));
  await findByText(/摘要內容/);                 // generated, visible
  fireEvent.press(getByText('逐字稿'));          // switch away
  fireEvent.press(getByText('AI 分析'));          // switch back
  // generation must NOT be queued again, and the notes are still there
  expect(mockAnalyzeBg).toHaveBeenCalledTimes(1);
  await waitFor(() => getByText(/摘要內容/));
});
