import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

const mockRecApi = {
  state: 'idle', durationMs: 0, meteringLevel: 0,
  parts: [], wasInterrupted: false,
  start: jest.fn(), pause: jest.fn(), resume: jest.fn(),
  stop: jest.fn().mockResolvedValue([{ uri: 'file:///r.m4a', durationMs: 1000 }]),
};
jest.mock('../../hooks/useRecorder', () => ({ useRecorder: () => mockRecApi }));
jest.mock('../../lib/api', () => ({
  createSession: jest.fn().mockResolvedValue('sess123'),
  uploadPart: jest.fn().mockResolvedValue(1),
}));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
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
import { pick } from '@react-native-documents/picker';

beforeEach(() => { jest.clearAllMocks(); mockRecApi.state = 'idle'; mockRecApi.wasInterrupted = false;
  // Re-establish implementations cleared by clearAllMocks
  (api.createSession as jest.Mock).mockResolvedValue('sess123');
  (api.uploadPart as jest.Mock).mockResolvedValue(1);
  (pick as jest.Mock).mockRejectedValue({ code: 'OPERATION_CANCELED' });
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
  await waitFor(() => expect(mockStore.upsert).toHaveBeenCalled()); // ensure session created
  fireEvent.press(getByText('結束'));
  await waitFor(() => expect(mockRecApi.stop).toHaveBeenCalled());
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Processing', { sessionId: 'sess123' }));
});

// C2 fix: onUpload must NOT call uploadPart; ProcessingScreen owns all uploads
test('C2: pressing 上傳 creates session, skips uploadPart, stores draft part, navigates to Processing', async () => {
  (pick as jest.Mock).mockResolvedValueOnce([{ uri: 'file:///u.m4a', name: 'u.m4a', type: 'audio/mp4' }]);
  const { getByText } = await render(<RecordScreen />);
  fireEvent.press(getByText('上傳音檔 / 影片'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Processing', { sessionId: 'sess123' }));
  expect(api.createSession).toHaveBeenCalled();
  expect(api.uploadPart).not.toHaveBeenCalled();
  expect(mockStore.upsert).toHaveBeenCalledWith(expect.objectContaining({
    parts: [{ uri: 'file:///u.m4a', durationMs: 0 }],
  }));
});

// I1 fix: record button disabled while createSession is unresolved
test('I1: record button is disabled until createSession resolves', async () => {
  let resolveSession!: (id: string) => void;
  const sessionPromise = new Promise<string>((res) => { resolveSession = res; });
  (api.createSession as jest.Mock).mockReturnValueOnce(sessionPromise);

  const { getByLabelText } = await render(<RecordScreen />);
  // sid is null → Pressable sets accessibilityState.disabled = true
  expect(getByLabelText('開始錄音').props.accessibilityState).toMatchObject({ disabled: true });

  // Resolve the session id
  await act(async () => { resolveSession('sess-resolved'); });

  // sid is now set → button is enabled (disabled false or absent)
  const disabledAfter = getByLabelText('開始錄音').props.accessibilityState?.disabled;
  expect(disabledAfter).toBeFalsy();
});
