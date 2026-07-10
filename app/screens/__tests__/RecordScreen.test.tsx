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
  pick: jest.fn().mockResolvedValue([{ uri: 'file:///u.m4a', name: 'u.m4a', type: 'audio/mp4' }]),
  keepLocalCopy: jest.fn().mockResolvedValue([{ status: 'success', sourceUri: 'file:///u.m4a', localUri: 'file:///doc/haoji/u.m4a' }]),
  types: { audio: 'public.audio', video: 'public.movie' },
  isErrorWithCode: (e: any) => !!e && typeof e.code === 'string',
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
}));
const mockReplace = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ replace: mockReplace, goBack: mockGoBack }) }));

const mockStore = {
  list: jest.fn().mockResolvedValue([]),
  get: jest.fn().mockResolvedValue({ id: 'sess123', createdAt: 0, title: 't', names: {}, unlocked: false, parts: [] }),
  upsert: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../lib/store-context', () => ({ useStore: () => mockStore }));

import RecordScreen from '../RecordScreen';
import * as api from '../../lib/api';
import { launchImageLibrary } from 'react-native-image-picker';

beforeEach(() => {
  jest.clearAllMocks(); mockRecApi.state = 'idle'; mockRecApi.wasInterrupted = false; mockRecApi.error = null;
  (launchImageLibrary as jest.Mock).mockResolvedValue({ didCancel: true });
});

test('tapping the record button starts recording', async () => {
  const { getByLabelText } = await render(<RecordScreen />);
  fireEvent.press(getByLabelText('開始錄音'));
  expect(mockRecApi.start).toHaveBeenCalled();
});

test('a recorder error is shown to the user (never silently idle) with a Settings shortcut', async () => {
  mockRecApi.error = '沒有麥克風權限，請到「設定 > 好記」開啟麥克風後再試。';
  const { getByText } = await render(<RecordScreen />);
  getByText(/沒有麥克風權限/);
  getByText('前往設定開啟麥克風');
});

test('while starting, the button shows busy and does not re-trigger start', async () => {
  mockRecApi.state = 'starting';
  const { getByLabelText } = await render(<RecordScreen />);
  const btn = getByLabelText('開始錄音');
  expect(btn.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  fireEvent.press(btn);
  expect(mockRecApi.start).not.toHaveBeenCalled();
});

// Recording is local-first: onUpload must NOT touch the backend (no createSession, no uploadPart —
// ProcessingScreen owns all backend work). It persists a draft part under a local id and hands off.
test('uploading a file does NOT call createSession/uploadPart, sets parts in store, and navigates to Processing', async () => {
  const { getByText } = await render(<RecordScreen />);
  fireEvent.press(getByText('從檔案上傳音檔'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Processing', { sessionId: expect.stringMatching(/^local-/) }));
  expect(api.createSession).not.toHaveBeenCalled();
  expect(api.uploadPart).not.toHaveBeenCalled();
  expect(mockStore.upsert).toHaveBeenCalledWith(expect.objectContaining({
    parts: [{ uri: expect.stringMatching(/^haoji\/local-.*\/part-0\.m4a$/), durationMs: 0 }], // relative, persisted
  }));
});

// 圖庫 (Photos) video path: image-picker returns a readable file:// uri (no keepLocalCopy needed),
// which we move straight into the persistent per-session dir. Still no backend call here.
test('picking a video from the library ingests it as a part and navigates to Processing (no backend)', async () => {
  (launchImageLibrary as jest.Mock).mockResolvedValueOnce({
    assets: [{ uri: 'file:///tmp/movie.mov', fileName: 'movie.mov', type: 'video/quicktime' }],
  });
  const { getByText } = await render(<RecordScreen />);
  fireEvent.press(getByText('從圖庫選影片'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Processing', { sessionId: expect.stringMatching(/^local-/) }));
  expect(api.createSession).not.toHaveBeenCalled();
  expect(api.uploadPart).not.toHaveBeenCalled();
  expect(mockStore.upsert).toHaveBeenCalledWith(expect.objectContaining({
    parts: [{ uri: expect.stringMatching(/^haoji\/local-.*\/part-0\.m4a$/), durationMs: 0 }],
  }));
});

test('cancelling the library picker is a no-op (no navigation, no error)', async () => {
  (launchImageLibrary as jest.Mock).mockResolvedValueOnce({ didCancel: true });
  const { getByText, queryByText } = await render(<RecordScreen />);
  fireEvent.press(getByText('從圖庫選影片'));
  await waitFor(() => expect(launchImageLibrary).toHaveBeenCalled());
  expect(mockReplace).not.toHaveBeenCalled();
  expect(queryByText('選取失敗')).toBeNull();
});

test('stopping recording persists parts and navigates to Processing with the local id', async () => {
  mockRecApi.state = 'recording';
  const { getByLabelText } = await render(<RecordScreen />);
  fireEvent.press(getByLabelText('停止錄音'));
  await waitFor(() => expect(mockRecApi.stop).toHaveBeenCalled());
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Processing', { sessionId: expect.stringMatching(/^local-/) }));
});

// Regression: opening the record screen and leaving without capturing anything must NOT create a
// blank record. No session is upserted on mount; stopping with zero parts just goes back.
test('opening the screen upserts nothing on mount (no blank record)', async () => {
  await render(<RecordScreen />);
  expect(mockStore.upsert).not.toHaveBeenCalled();
});

test('stopping with no recorded parts creates no session and navigates back', async () => {
  mockRecApi.state = 'recording';
  mockRecApi.stop.mockResolvedValueOnce([]); // nothing captured
  const { getByLabelText } = await render(<RecordScreen />);
  fireEvent.press(getByLabelText('停止錄音'));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
  expect(mockStore.upsert).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});
