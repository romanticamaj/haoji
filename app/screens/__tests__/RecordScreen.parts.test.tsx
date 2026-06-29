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
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: true }),
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

beforeEach(() => { jest.clearAllMocks(); mockRecApi.state = 'idle'; mockRecApi.wasInterrupted = false; });

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
