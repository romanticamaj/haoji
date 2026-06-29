import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockPlayer = { positionMs: 0, isPlaying: false, load: jest.fn().mockResolvedValue(undefined), seek: jest.fn(), toggle: jest.fn(), unload: jest.fn() };
jest.mock('../../hooks/usePlayer', () => ({ usePlayer: () => mockPlayer }));

import RecordingsList from '../RecordingsList';

const parts = [
  { uri: 'file://p1', durationMs: 61000 },
  { uri: 'file://p2', durationMs: 125000 },
];

beforeEach(() => { jest.clearAllMocks(); });

test('renders one row per part with label and duration', async () => {
  const { getByText } = await render(<RecordingsList parts={parts} />);
  getByText('段 1');
  getByText('段 2');
  getByText('01:01');   // 61000ms → 61s → 01:01
  getByText('02:05');   // 125000ms → 125s → 02:05
});

test('pressing play on row 1 calls load with its uri then toggle', async () => {
  const { getByTestId } = await render(<RecordingsList parts={parts} />);
  fireEvent.press(getByTestId('play-0'));
  await waitFor(() => expect(mockPlayer.load).toHaveBeenCalledWith('file://p1'));
  await waitFor(() => expect(mockPlayer.toggle).toHaveBeenCalled());
});

test('pressing play on row 2 calls load with its uri', async () => {
  const { getByTestId } = await render(<RecordingsList parts={parts} />);
  fireEvent.press(getByTestId('play-1'));
  await waitFor(() => expect(mockPlayer.load).toHaveBeenCalledWith('file://p2'));
});

test('renders nothing when parts is empty', async () => {
  const { queryByText } = await render(<RecordingsList parts={[]} />);
  expect(queryByText('段 1')).toBeNull();
});
