import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockCreateSession = jest.fn();
const mockUploadPart = jest.fn();
const mockTranscribe = jest.fn();
const mockGetSession = jest.fn();
jest.mock('../../lib/api', () => ({
  createSession: (...a: any[]) => mockCreateSession(...a),
  uploadPart: (...a: any[]) => mockUploadPart(...a),
  transcribe: (...a: any[]) => mockTranscribe(...a),
  getSession: (...a: any[]) => mockGetSession(...a),
}));
const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ replace: mockReplace }),
  useRoute: () => ({ params: { sessionId: 'sess-parts' } }),
}));
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore } from '../../lib/store';
import ProcessingScreen from '../ProcessingScreen';

beforeEach(() => { jest.clearAllMocks(); });

test('uploads both parts in order, transcribes, polls until done, preserves parts/title/names in saved session', async () => {
  mockCreateSession.mockResolvedValue('backend-1');
  mockUploadPart.mockResolvedValue(1);
  mockTranscribe.mockResolvedValue(undefined);
  mockGetSession
    .mockResolvedValueOnce({ status: 'running', pct: 0.5, message: '辨識中…' })
    .mockResolvedValueOnce({
      status: 'done', pct: 1, message: '完成',
      transcript: { segments: [{ start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好世界' }], speakers: ['SPEAKER_00'] },
    });

  const parts = [
    { uri: 'file://part0.m4a', durationMs: 5000 },
    { uri: 'file://part1.m4a', durationMs: 4000 },
  ];
  const store = createMemoryStore([{
    id: 'sess-parts', createdAt: 1000, title: '測試錄音',
    names: { SPEAKER_00: 'Alice' }, notes: undefined, unlocked: false, parts,
  }]);

  await render(<StoreProvider store={store}><ProcessingScreen /></StoreProvider>);

  await waitFor(
    () => expect(mockReplace).toHaveBeenCalledWith('Results', { sessionId: 'sess-parts' }),
    { timeout: 12000 },
  );

  // Both parts uploaded in order, keyed on the lazily-created backend id (NOT the local route id)
  expect(mockUploadPart).toHaveBeenCalledTimes(2);
  expect(mockUploadPart).toHaveBeenNthCalledWith(1, 'backend-1', { uri: 'file://part0.m4a', name: 'part-0.m4a', mime: 'audio/mp4' });
  expect(mockUploadPart).toHaveBeenNthCalledWith(2, 'backend-1', { uri: 'file://part1.m4a', name: 'part-1.m4a', mime: 'audio/mp4' });

  // transcribe called once with the backend id
  expect(mockTranscribe).toHaveBeenCalledWith('backend-1');

  // Transcript saved under the LOCAL id; parts/title/names preserved; backend id recorded
  const saved = await store.get('sess-parts');
  expect(saved?.transcript?.speakers).toEqual(['SPEAKER_00']);
  expect(saved?.parts).toEqual(parts);
  expect(saved?.names).toEqual({ SPEAKER_00: 'Alice' });
  expect(saved?.title).toBe('測試錄音');
  expect(saved?.backendId).toBe('backend-1');
});
