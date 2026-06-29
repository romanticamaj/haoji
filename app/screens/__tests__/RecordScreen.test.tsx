import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

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
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///u.m4a', name: 'u.m4a', mimeType: 'audio/mp4' }] }),
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

beforeEach(() => { jest.clearAllMocks(); mockRecApi.state = 'idle'; mockRecApi.wasInterrupted = false; });

test('tapping the record button starts recording', async () => {
  const { getByLabelText } = await render(<RecordScreen />);
  fireEvent.press(getByLabelText('開始錄音'));
  expect(mockRecApi.start).toHaveBeenCalled();
});

test('uploading a file creates a session, uploads the part, and navigates to Processing', async () => {
  const { getByText } = await render(<RecordScreen />);
  fireEvent.press(getByText('上傳音檔 / 影片'));
  await waitFor(() => expect(api.uploadPart).toHaveBeenCalledWith('sess123', { uri: 'file:///u.m4a', name: 'u.m4a', mime: 'audio/mp4' }));
  expect(mockReplace).toHaveBeenCalledWith('Processing', { sessionId: 'sess123' });
});

test('stopping recording persists parts and navigates to Processing', async () => {
  mockRecApi.state = 'recording';
  const { getByLabelText } = await render(<RecordScreen />);
  fireEvent.press(getByLabelText('停止錄音'));
  await waitFor(() => expect(mockRecApi.stop).toHaveBeenCalled());
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Processing', { sessionId: 'sess123' }));
});
