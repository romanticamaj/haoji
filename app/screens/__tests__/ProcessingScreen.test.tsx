import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockGetSession = jest.fn();
jest.mock('../../lib/api', () => ({ getSession: (...a: any[]) => mockGetSession(...a) }));
const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ replace: mockReplace }),
  useRoute: () => ({ params: { sessionId: 'sess123' } }),
}));
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore } from '../../lib/store';
import ProcessingScreen from '../ProcessingScreen';

beforeEach(() => { jest.clearAllMocks(); });

test('polls until done, saves session, navigates to Results', async () => {
  mockGetSession
    .mockResolvedValueOnce({ status: 'running', pct: 0.5, message: '辨識中…' })
    .mockResolvedValueOnce({ status: 'done', pct: 1, message: '完成',
      transcript: { segments: [{ start: 0, end: 1, speaker: 'SPEAKER_00', text: '你好' }], speakers: ['SPEAKER_00'] } });
  const store = createMemoryStore();
  await render(<StoreProvider store={store}><ProcessingScreen /></StoreProvider>);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Results', { sessionId: 'sess123' }), { timeout: 8000 });
  const saved = await store.get('sess123');
  expect(saved?.transcript?.speakers).toEqual(['SPEAKER_00']);
});
