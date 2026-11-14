import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockRecApi = {
  state: 'idle', durationMs: 0, meteringLevel: 0,
  parts: [], wasInterrupted: false, error: null as string | null,
  start: jest.fn(), pause: jest.fn(), resume: jest.fn(), clearError: jest.fn(),
  stop: jest.fn().mockResolvedValue([{ uri: 'file:///r.m4a', durationMs: 1000 }]),
};
jest.mock('../../hooks/useRecorder', () => ({ useRecorder: () => mockRecApi }));
jest.mock('../../lib/api', () => ({
  createSession: jest.fn().mockResolvedValue('sess123'),
  uploadPart: jest.fn().mockResolvedValue(1),
}));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  keepLocalCopy: jest.fn(),
  types: { audio: 'public.audio', video: 'public.movie' },
  isErrorWithCode: (e: any) => !!e && typeof e.code === 'string',
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
}));
const mockReplace = jest.fn();
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
// route params carry `appendTo` (continue recording into an existing meeting); default = a new one.
const mockRouteParams: { current: any } = { current: undefined };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ replace: mockReplace, goBack: mockGoBack, navigate: mockNavigate }),
  useRoute: () => ({ params: mockRouteParams.current }),
}));

const mockStore = {
  list: jest.fn().mockResolvedValue([]),
  get: jest.fn().mockResolvedValue({ id: 'sess123', createdAt: 0, title: 't', names: {}, unlocked: false, parts: [] }),
  upsert: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../lib/store-context', () => ({ useStore: () => mockStore }));

import RecordScreen from '../RecordScreen';
import * as api from '../../lib/api';
import { pick, keepLocalCopy } from '@react-native-documents/picker';

beforeEach(() => { jest.clearAllMocks(); mockNavigate.mockClear(); mockRouteParams.current = undefined; mockRecApi.state = 'idle'; mockRecApi.wasInterrupted = false; mockRecApi.error = null;
  // Re-establish implementations cleared by clearAllMocks
  (api.createSession as jest.Mock).mockResolvedValue('sess123');
  (api.uploadPart as jest.Mock).mockResolvedValue(1);
  (pick as jest.Mock).mockRejectedValue({ code: 'OPERATION_CANCELED' });
  (keepLocalCopy as jest.Mock).mockResolvedValue([{ status: 'success', sourceUri: 'file:///u.m4a', localUri: 'file:///doc/haoji/u.m4a' }]);
  mockStore.upsert.mockResolvedValue(undefined);
  mockStore.get.mockResolvedValue({ id: 'sess123', createdAt: 0, title: 't', names: {}, unlocked: false, parts: [] });
  mockRecApi.stop.mockResolvedValue([{ uri: 'file:///r.m4a', durationMs: 1000 }]);
});

test('shows interruption prompt when wasInterrupted is true', async () => {
  mockRecApi.wasInterrupted = true;
  const { getByText } = await render(<RecordScreen />);
  getByText('錄音被中斷了');
  getByText('繼續');
  getByText('結束');
});

test('pressing 繼續 in interruption prompt calls resume', async () => {
  mockRecApi.wasInterrupted = true;
  const { getByText } = await render(<RecordScreen />);
  fireEvent.press(getByText('繼續'));
  expect(mockRecApi.resume).toHaveBeenCalled();
});

test('pressing 結束 in interruption prompt stops recording and navigates to Review', async () => {
  mockRecApi.wasInterrupted = true;
  const { getByText } = await render(<RecordScreen />);
  fireEvent.press(getByText('結束'));
  await waitFor(() => expect(mockRecApi.stop).toHaveBeenCalled());
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Review', { sessionId: expect.stringMatching(/^local-/) }));
});

// C2 + local-first: onUpload must NOT call createSession or uploadPart; ProcessingScreen owns all backend work
test('C2: pressing 上傳 copies file into the persistent per-session dir, skips backend, navigates to Review', async () => {
  (pick as jest.Mock).mockResolvedValueOnce([{ uri: 'file:///u.m4a', name: 'u.m4a', type: 'audio/mp4' }]);
  const { getByText } = await render(<RecordScreen />);
  fireEvent.press(getByText('匯入音檔（可多選）'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Review', { sessionId: expect.stringMatching(/^local-/) }));
  expect(api.createSession).not.toHaveBeenCalled();
  expect(api.uploadPart).not.toHaveBeenCalled();
  // First copy out of the security-scoped picker uri into the app cache...
  expect(keepLocalCopy).toHaveBeenCalledWith(expect.objectContaining({
    files: [{ uri: 'file:///u.m4a', fileName: 'u.m4a' }], destination: 'cachesDirectory',
  }));
  // ...then persist as a RELATIVE per-session path (survives app updates), not an absolute uri.
  expect(mockStore.upsert).toHaveBeenCalledWith(expect.objectContaining({
    parts: [{ uri: expect.stringMatching(/^haoji\/local-.*\/part-0\.m4a$/), durationMs: 0 }],
  }));
});

// Multi-select is a DECISION, not a formality: the files may not all be audio, and joining them is
// not undoable. Nothing is committed until the user has confirmed what was actually picked.
test('multi-select goes to the confirmation step instead of importing straight away', async () => {
  (pick as jest.Mock).mockResolvedValueOnce([
    { uri: 'file:///a.m4a', name: 'a.m4a', type: 'audio/mp4' },
    { uri: 'file:///b.m4a', name: 'b.m4a', type: 'audio/mp4' },
  ]);
  (keepLocalCopy as jest.Mock).mockResolvedValueOnce([
    { status: 'success', sourceUri: 'file:///a.m4a', localUri: 'file:///doc/haoji/a.m4a' },
    { status: 'success', sourceUri: 'file:///b.m4a', localUri: 'file:///doc/haoji/b.m4a' },
  ]);
  const { getByText } = await render(<RecordScreen />);
  fireEvent.press(getByText('匯入音檔（可多選）'));

  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('ImportConfirm', {
    files: [
      { uri: 'file:///doc/haoji/a.m4a', name: 'a.m4a' },
      { uri: 'file:///doc/haoji/b.m4a', name: 'b.m4a' },
    ],
  }));
  // both files were still copied out of the security-scoped picker uris first
  expect(keepLocalCopy).toHaveBeenCalledWith(expect.objectContaining({
    files: [{ uri: 'file:///a.m4a', fileName: 'a.m4a' }, { uri: 'file:///b.m4a', fileName: 'b.m4a' }],
    destination: 'cachesDirectory',
  }));
  // ...but NOTHING is committed yet
  expect(mockStore.upsert).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(api.createSession).not.toHaveBeenCalled();
});

test('a single picked file still imports directly (no decision to make)', async () => {
  (pick as jest.Mock).mockResolvedValueOnce([{ uri: 'file:///u.m4a', name: 'u.m4a', type: 'audio/mp4' }]);
  const { getByText } = await render(<RecordScreen />);
  fireEvent.press(getByText('匯入音檔（可多選）'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Review', { sessionId: expect.stringMatching(/^local-/) }));
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('upload surfaces an error (not a hang) when the local copy fails', async () => {
  (pick as jest.Mock).mockResolvedValueOnce([{ uri: 'file:///u.m4a', name: 'u.m4a', type: 'audio/mp4' }]);
  (keepLocalCopy as jest.Mock).mockResolvedValueOnce([{ status: 'error', sourceUri: 'file:///u.m4a', copyError: 'boom' }]);
  const { getByText } = await render(<RecordScreen />);
  fireEvent.press(getByText('匯入音檔（可多選）'));
  await waitFor(() => getByText(/檔案複製失敗，原本的檔案沒有變動/));
  expect(mockReplace).not.toHaveBeenCalled();
});

// Local-first fix (replaces the old I1 "disable until createSession resolves" behavior, which WAS the
// bug): recording must be usable instantly, with no backend round-trip.
test('record button is enabled immediately without any backend call', async () => {
  const { getByLabelText } = await render(<RecordScreen />);
  const disabled = getByLabelText('開始錄音').props.accessibilityState?.disabled;
  expect(disabled).toBeFalsy();
  expect(api.createSession).not.toHaveBeenCalled();
});


// 繼續錄音: a discussion that was interrupted (or simply resumed later) should stay ONE meeting, so it
// is transcribed and analysed as a single conversation instead of becoming a second recording.
test('append mode records into the EXISTING meeting instead of starting a new one', async () => {
  mockRouteParams.current = { appendTo: 'sess-existing' };
  mockStore.get.mockResolvedValue({
    id: 'sess-existing', createdAt: 5, title: '客戶月會', names: { S0: 'Gary' }, unlocked: true,
    transcript: { speakers: ['S0'], segments: [{ start: 0, end: 1, speaker: 'S0', text: '嗨' }] },
    notes: '## 會議摘要\n舊內容',
    parts: [{ uri: 'haoji/sess-existing/part-0.wav', durationMs: 1000 }],
  });
  mockRecApi.state = 'recording';
  mockRecApi.stop.mockResolvedValue([
    { uri: 'haoji/sess-existing/part-0.wav', durationMs: 1000 },
    { uri: 'haoji/sess-existing/part-1.wav', durationMs: 2000 },
  ]);

  const { getByLabelText } = await render(<RecordScreen />);
  fireEvent.press(getByLabelText('停止錄音'));

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Review', { sessionId: 'sess-existing' }));
  // the meeting's own identity and content survive — a plain upsert here used to wipe them
  expect(mockStore.upsert).toHaveBeenCalledWith(expect.objectContaining({
    id: 'sess-existing',
    title: '客戶月會',
    createdAt: 5,
    names: { S0: 'Gary' },
    notes: '## 會議摘要\n舊內容',
    parts: [
      { uri: 'haoji/sess-existing/part-0.wav', durationMs: 1000 },
      { uri: 'haoji/sess-existing/part-1.wav', durationMs: 2000 },
    ],
  }));
});

test('without appendTo a brand-new meeting id is minted (unchanged behaviour)', async () => {
  mockRecApi.state = 'recording';
  const { getByLabelText } = await render(<RecordScreen />);
  fireEvent.press(getByLabelText('停止錄音'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Review',
    { sessionId: expect.stringMatching(/^local-/) }));
});

// An interruption FINALISES the part being recorded, so what the meeting holds grows mid-session.
// Counting only the parts present when the screen opened made the clock jump backwards the moment a
// call ended — 00:11 became 00:03 — which reads exactly like the earlier audio had been wiped.
test('the timer keeps counting parts finalised by an interruption', async () => {
  mockRecApi.state = 'recording';
  mockRecApi.wasInterrupted = false;
  mockRecApi.parts = [{ uri: 'file:///part-0.wav', durationMs: 11_000 }] as any;  // closed by the call
  mockRecApi.durationMs = 3_000;                                                  // the take after it

  const { findByText } = await render(<RecordScreen />);
  await findByText('00:14');            // 11 + 3, not 00:03
});

test('before recording starts, an appended meeting shows what it already holds', async () => {
  mockRouteParams.current = { appendTo: 'sess123' };
  mockStore.get.mockResolvedValue({
    id: 'sess123', createdAt: 0, title: 't', names: {}, unlocked: false,
    parts: [{ uri: 'file:///part-0.wav', durationMs: 33_000 }],
  });
  mockRecApi.state = 'idle';
  mockRecApi.parts = [] as any;          // the hook has not adopted them yet
  mockRecApi.durationMs = 0;

  const { findByText } = await render(<RecordScreen />);
  await findByText('00:33');
});

// Seen in Results on the simulator: new meetings were titled 「11/14/2026 下午12:51:21」 — the JS
// engine's en-US date with a Chinese AM/PM. Titles the app writes itself use the zh-TW formatter.
test('a new meeting is titled with a zh-TW date, never an en-US stamp', async () => {
  (pick as jest.Mock).mockResolvedValueOnce([{ uri: 'file:///u.m4a', name: 'u.m4a', type: 'audio/mp4' }]);
  const { getByText } = await render(<RecordScreen />);
  fireEvent.press(getByText('匯入音檔（可多選）'));
  await waitFor(() => expect(mockStore.upsert).toHaveBeenCalled());
  const title = mockStore.upsert.mock.calls[0][0].title as string;
  expect(title).toMatch(/^\d{1,2}月\d{1,2}日/);
  expect(title).not.toMatch(/\d+\/\d+\/\d{4}/);
});
