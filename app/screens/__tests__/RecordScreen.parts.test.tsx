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
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ replace: mockReplace }) }));

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

beforeEach(() => { jest.clearAllMocks(); mockRecApi.state = 'idle'; mockRecApi.wasInterrupted = false; mockRecApi.error = null;
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
  getByText('錄音被中斷，要接著錄嗎？');
  getByText('繼續');
  getByText('結束');
});

test('pressing 繼續 in interruption prompt calls resume', async () => {
  mockRecApi.wasInterrupted = true;
  const { getByText } = await render(<RecordScreen />);
  fireEvent.press(getByText('繼續'));
  expect(mockRecApi.resume).toHaveBeenCalled();
});

test('pressing 結束 in interruption prompt stops recording and navigates to Processing', async () => {
  mockRecApi.wasInterrupted = true;
  const { getByText } = await render(<RecordScreen />);
  await waitFor(() => expect(mockStore.upsert).toHaveBeenCalled()); // ensure local session created
  fireEvent.press(getByText('結束'));
  await waitFor(() => expect(mockRecApi.stop).toHaveBeenCalled());
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Processing', { sessionId: expect.stringMatching(/^local-/) }));
});

// C2 + local-first: onUpload must NOT call createSession or uploadPart; ProcessingScreen owns all backend work
test('C2: pressing 上傳 copies file into the persistent per-session dir, skips backend, navigates to Processing', async () => {
  (pick as jest.Mock).mockResolvedValueOnce([{ uri: 'file:///u.m4a', name: 'u.m4a', type: 'audio/mp4' }]);
  const { getByText } = await render(<RecordScreen />);
  fireEvent.press(getByText('從檔案上傳音檔'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Processing', { sessionId: expect.stringMatching(/^local-/) }));
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

test('upload surfaces an error (not a hang) when the local copy fails', async () => {
  (pick as jest.Mock).mockResolvedValueOnce([{ uri: 'file:///u.m4a', name: 'u.m4a', type: 'audio/mp4' }]);
  (keepLocalCopy as jest.Mock).mockResolvedValueOnce([{ status: 'error', sourceUri: 'file:///u.m4a', copyError: 'boom' }]);
  const { getByText } = await render(<RecordScreen />);
  fireEvent.press(getByText('從檔案上傳音檔'));
  await waitFor(() => getByText('boom'));
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
