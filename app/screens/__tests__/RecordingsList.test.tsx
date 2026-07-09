import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// One shared mock player instance is returned for every usePlayer() call in a test. That's fine
// here: assertions only inspect load/seek/toggle call args, not per-row isolation.
const mockPlayer = {
  positionMs: 0, durationMs: 0, isPlaying: false,
  load: jest.fn().mockResolvedValue(undefined),
  seek: jest.fn().mockResolvedValue(undefined),
  toggle: jest.fn().mockResolvedValue(undefined),
  setSpeed: jest.fn().mockResolvedValue(undefined),
  unload: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../hooks/usePlayer', () => ({ usePlayer: () => mockPlayer }));

import RecordingsList from '../RecordingsList';

const parts = [
  { uri: 'file://p1', durationMs: 61000 },
  { uri: 'file://p2', durationMs: 125000 },
];

beforeEach(() => { jest.clearAllMocks(); });

test('multi-part renders a labelled row per part with its duration', async () => {
  const { getByText, getAllByText } = await render(<RecordingsList parts={parts} />);
  getByText('段 1');
  getByText('段 2');
  // Each part's duration shows in both its 段 header and its total-time slot.
  expect(getAllByText('01:01').length).toBeGreaterThan(0); // 61000ms → 61s → 01:01
  expect(getAllByText('02:05').length).toBeGreaterThan(0); // 125000ms → 125s → 02:05
});

test('single part omits the 段 label', async () => {
  const { queryByText } = await render(<RecordingsList parts={[parts[0]]} />);
  expect(queryByText('段 1')).toBeNull();
});

test('pressing play loads the part uri then toggles', async () => {
  const { getByTestId } = await render(<RecordingsList parts={parts} />);
  fireEvent.press(getByTestId('play-0'));
  await waitFor(() => expect(mockPlayer.load).toHaveBeenCalledWith('file:///doc/p1')); // resolved to current Documents dir
  await waitFor(() => expect(mockPlayer.toggle).toHaveBeenCalled());
});

test('pressing play on row 2 loads its uri', async () => {
  const { getByTestId } = await render(<RecordingsList parts={parts} />);
  fireEvent.press(getByTestId('play-1'));
  await waitFor(() => expect(mockPlayer.load).toHaveBeenCalledWith('file:///doc/p2'));
});

test('skip-back and skip-forward seek relative to the current position', async () => {
  mockPlayer.positionMs = 20000;
  const { getByLabelText } = await render(<RecordingsList parts={[parts[0]]} />);
  fireEvent.press(getByLabelText('倒退 15 秒'));
  await waitFor(() => expect(mockPlayer.seek).toHaveBeenCalledWith(5000)); // 20000 - 15000
  mockPlayer.seek.mockClear();
  fireEvent.press(getByLabelText('快進 30 秒'));
  await waitFor(() => expect(mockPlayer.seek).toHaveBeenCalledWith(50000)); // 20000 + 30000, clamped to 61000
  mockPlayer.positionMs = 0;
});

test('speed button cycles 1.0× → 1.5× → 2.0× → 1.0×', async () => {
  const { getByText } = await render(<RecordingsList parts={[parts[0]]} />);
  getByText('1.0×');
  fireEvent.press(getByText('1.0×'));
  await waitFor(() => expect(mockPlayer.setSpeed).toHaveBeenLastCalledWith(1.5));
  fireEvent.press(getByText('1.5×'));
  await waitFor(() => expect(mockPlayer.setSpeed).toHaveBeenLastCalledWith(2));
  fireEvent.press(getByText('2.0×'));
  await waitFor(() => expect(mockPlayer.setSpeed).toHaveBeenLastCalledWith(1));
});

test('renders nothing when parts is empty', async () => {
  const { queryByText } = await render(<RecordingsList parts={[]} />);
  expect(queryByText('段 1')).toBeNull();
});
