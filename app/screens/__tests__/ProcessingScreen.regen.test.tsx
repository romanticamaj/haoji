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
  // regen: true — invoked from "重新生成逐字稿"
  useRoute: () => ({ params: { sessionId: 'sess123', regen: true } }),
}));
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore, SavedSession } from '../../lib/store';
import ProcessingScreen from '../ProcessingScreen';

const dead: SavedSession = {
  id: 'sess123', createdAt: 1, title: 't', unlocked: false, names: {},
  backendId: 'old-dead-backend', // stale session whose parts were deleted server-side
  parts: [{ uri: 'file:///p/part-0.m4a', durationMs: 1000 }],
};

beforeEach(() => { jest.clearAllMocks(); });

test('regen ignores the stale backendId, creates a fresh session, re-uploads parts, saves new id', async () => {
  mockCreateSession.mockResolvedValue('fresh-backend');
  mockTranscribe.mockResolvedValue(undefined);
  mockGetSession.mockResolvedValueOnce({ status: 'done', pct: 1, message: '完成',
    transcript: { segments: [{ start: 0, end: 1, speaker: 'SPEAKER_00', text: '你好' }], speakers: ['SPEAKER_00'] } });
  const store = createMemoryStore([dead]);
  await render(<StoreProvider store={store}><ProcessingScreen /></StoreProvider>);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Results',
    expect.objectContaining({ sessionId: 'sess123', session: expect.objectContaining({ id: 'sess123' }) })), { timeout: 8000 });
  expect(mockCreateSession).toHaveBeenCalled();                 // did NOT reuse old-dead-backend
  expect(mockUploadPart).toHaveBeenCalledWith('fresh-backend', expect.objectContaining({ name: 'part-0.m4a' }), 0);
  expect(mockTranscribe).toHaveBeenCalledWith('fresh-backend');
  const saved = await store.get('sess123');
  expect(saved?.backendId).toBe('fresh-backend');
  expect(saved?.transcript?.speakers).toEqual(['SPEAKER_00']);
});
