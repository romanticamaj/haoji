import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockRecApi = { state: 'idle', durationMs: 0, meteringLevel: 0,
  start: jest.fn(), pause: jest.fn(), resume: jest.fn(),
  stop: jest.fn().mockResolvedValue({ uri: 'file:///r.m4a', name: 'r.m4a', mime: 'audio/mp4' }) };
jest.mock('../../hooks/useRecorder', () => ({ useRecorder: () => mockRecApi }));
jest.mock('../../lib/api', () => ({ createSession: jest.fn().mockResolvedValue('sess123') }));
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///u.m4a', name: 'u.m4a', mimeType: 'audio/mp4' }] }),
}));
const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ replace: mockReplace }) }));

import RecordScreen from '../RecordScreen';
import * as api from '../../lib/api';

beforeEach(() => { jest.clearAllMocks(); mockRecApi.state = 'idle'; });

test('tapping the record button starts recording', async () => {
  const { getByLabelText } = await render(<RecordScreen />);
  fireEvent.press(getByLabelText('開始錄音'));
  expect(mockRecApi.start).toHaveBeenCalled();
});

test('uploading a file creates a session and navigates to Processing', async () => {
  const { getByText } = await render(<RecordScreen />);
  fireEvent.press(getByText('上傳音檔 / 影片'));
  await waitFor(() => expect(api.createSession).toHaveBeenCalledWith({ uri: 'file:///u.m4a', name: 'u.m4a', mime: 'audio/mp4' }));
  expect(mockReplace).toHaveBeenCalledWith('Processing', { sessionId: 'sess123' });
});

test('stopping recording uploads the file and navigates to Processing', async () => {
  mockRecApi.state = 'recording';
  const { getByLabelText } = await render(<RecordScreen />);
  fireEvent.press(getByLabelText('停止錄音'));
  await waitFor(() => expect(mockRecApi.stop).toHaveBeenCalled());
  await waitFor(() => expect(api.createSession).toHaveBeenCalledWith({ uri: 'file:///r.m4a', name: 'r.m4a', mime: 'audio/mp4' }));
  expect(mockReplace).toHaveBeenCalledWith('Processing', { sessionId: 'sess123' });
});
