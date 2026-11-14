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
  // The server-status poll (useServerStatus): a connected server (busy still accepts work).
  getStatus: jest.fn().mockResolvedValue(require('../../../backend/tests/fixtures/contracts/status.json')),
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

// 繼續錄音 on a meeting that was already analysed, then 重新生成逐字稿: the session still carries
// job.stage === 'done' from the FIRST analysis. Acting on that before the restart had cleared it
// bounced straight back to the results — "一進去就跳出", and the appended audio was never processed.
test('a previously analysed meeting does not bounce straight back out of Processing', async () => {
  const analysed: SavedSession = {
    ...dead,
    transcript: { speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 1, speaker: 'SPEAKER_00', text: '舊的' }] },
    notes: '## 會議摘要\n舊的',
    // left over from the FIRST analysis
    job: { stage: 'done', uploaded: 1, pct: 1, message: '完成', updatedAt: 1 },
    parts: [{ uri: 'file:///p/part-0.wav', durationMs: 5000 }],   // now includes the appended audio
  };
  const fresh = { speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 9, speaker: 'SPEAKER_00', text: '新的' }] };
  mockCreateSession.mockResolvedValue('fresh-backend');
  mockTranscribe.mockResolvedValue(undefined);
  mockGetSession
    .mockResolvedValueOnce({ status: 'running', pct: 0.3, message: '辨識中…' })
    .mockResolvedValue({ status: 'done', pct: 1, message: '完成', transcript: fresh });

  const store = createMemoryStore([analysed]);
  await render(<StoreProvider store={store}><ProcessingScreen /></StoreProvider>);

  // The re-run must actually begin...
  await waitFor(() => expect(mockCreateSession).toHaveBeenCalled(), { timeout: 8000 });
  // ...and at that point we must still be here. This is the bug: the stale 'done' used to send us
  // back to the results before any of the appended audio was processed.
  expect(mockReplace).not.toHaveBeenCalled();

  // Leaving happens only once THIS run finishes, and with the new transcript.
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Results', expect.anything()), { timeout: 8000 });
  expect((await store.get('sess123'))?.transcript?.segments[0].text).toBe('新的');
});
