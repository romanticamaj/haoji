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

beforeEach(() => { jest.clearAllMocks(); mockRecApi.state = 'idle'; mockRecApi.wasInterrupted = false; mockRecApi.error = null; });

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
  fireEvent.press(getByText('上傳音檔 / 影片'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Processing', { sessionId: expect.stringMatching(/^local-/) }));
  expect(api.createSession).not.toHaveBeenCalled();
  expect(api.uploadPart).not.toHaveBeenCalled();
  expect(mockStore.upsert).toHaveBeenCalledWith(expect.objectContaining({
    parts: [{ uri: 'file:///u.m4a', durationMs: 0 }],
  }));
});

test('stopping recording persists parts and navigates to Processing with the local id', async () => {
  mockRecApi.state = 'recording';
  const { getByLabelText } = await render(<RecordScreen />);
  fireEvent.press(getByLabelText('停止錄音'));
  await waitFor(() => expect(mockRecApi.stop).toHaveBeenCalled());
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Processing', { sessionId: expect.stringMatching(/^local-/) }));
});
