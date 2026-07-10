import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// One shared mock player (the real hook is hoisted to one instance per list). Assertions inspect
// toggle/seek/setSpeed call args — each takes the uri it acts on, matching the new PlayerApi.
const mockPlayer = {
  activeUri: null as string | null,
  positionMs: 0, durationMs: 0, isPlaying: false,
  toggle: jest.fn().mockResolvedValue(undefined),
  seek: jest.fn().mockResolvedValue(undefined),
  setSpeed: jest.fn().mockResolvedValue(undefined),
  reset: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../hooks/usePlayer', () => ({ usePlayer: () => mockPlayer }));

// Keep the real resolvePartUri; control file existence per test (default: file present).
const mockPartExists = jest.fn().mockResolvedValue(true);
jest.mock('../../lib/recordings', () => ({
  ...jest.requireActual('../../lib/recordings'),
  partExists: (...a: any[]) => mockPartExists(...a),
}));

import RecordingsList from '../RecordingsList';

const parts = [
  { uri: 'file://p1', durationMs: 61000 },
  { uri: 'file://p2', durationMs: 125000 },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockPlayer.activeUri = null; mockPlayer.positionMs = 0; mockPlayer.durationMs = 0; mockPlayer.isPlaying = false;
  mockPartExists.mockResolvedValue(true);
});

test('multi-part renders a labelled row per part with its duration', async () => {
  const { getByText, getAllByText } = await render(<RecordingsList parts={parts} />);
  getByText('段 1');
  getByText('段 2');
  expect(getAllByText('01:01').length).toBeGreaterThan(0); // 61000ms → 01:01
  expect(getAllByText('02:05').length).toBeGreaterThan(0); // 125000ms → 02:05
});

test('single part omits the 段 label', async () => {
  const { queryByText } = await render(<RecordingsList parts={[parts[0]]} />);
  expect(queryByText('段 1')).toBeNull();
});

test('pressing play toggles the resolved part uri', async () => {
  const { getByTestId } = await render(<RecordingsList parts={parts} />);
  fireEvent.press(getByTestId('play-0'));
  await waitFor(() => expect(mockPlayer.toggle).toHaveBeenCalledWith('file:///doc/p1')); // resolved to Documents dir
});

test('pressing play on row 2 toggles its uri', async () => {
  const { getByTestId } = await render(<RecordingsList parts={parts} />);
  fireEvent.press(getByTestId('play-1'));
  await waitFor(() => expect(mockPlayer.toggle).toHaveBeenCalledWith('file:///doc/p2'));
});

test('skip seeks relative to the active track position (uri + clamped ms)', async () => {
  // Row is the active track at 20s so skips are relative to the live position.
  mockPlayer.activeUri = 'file:///doc/p1';
  mockPlayer.positionMs = 20000;
  const { getByLabelText } = await render(<RecordingsList parts={[parts[0]]} />);
  fireEvent.press(getByLabelText('倒退 15 秒'));
  await waitFor(() => expect(mockPlayer.seek).toHaveBeenCalledWith('file:///doc/p1', 5000)); // 20000 - 15000
  mockPlayer.seek.mockClear();
  fireEvent.press(getByLabelText('快進 30 秒'));
  await waitFor(() => expect(mockPlayer.seek).toHaveBeenCalledWith('file:///doc/p1', 50000)); // 20000 + 30000, clamped to 61000
});

test('skip-back before playing clamps to 0 (not negative), still targeting the uri', async () => {
  // Not active (activeUri null) → base position is 0; skip-back must clamp at 0, not no-op.
  const { getByLabelText } = await render(<RecordingsList parts={[parts[0]]} />);
  fireEvent.press(getByLabelText('倒退 15 秒'));
  await waitFor(() => expect(mockPlayer.seek).toHaveBeenCalledWith('file:///doc/p1', 0));
});

test('speed button cycles 1.0× → 1.5× → 2.0× → 1.0× (per uri)', async () => {
  const { getByText } = await render(<RecordingsList parts={[parts[0]]} />);
  getByText('1.0×');
  fireEvent.press(getByText('1.0×'));
  await waitFor(() => expect(mockPlayer.setSpeed).toHaveBeenLastCalledWith('file:///doc/p1', 1.5));
  fireEvent.press(getByText('1.5×'));
  await waitFor(() => expect(mockPlayer.setSpeed).toHaveBeenLastCalledWith('file:///doc/p1', 2));
  fireEvent.press(getByText('2.0×'));
  await waitFor(() => expect(mockPlayer.setSpeed).toHaveBeenLastCalledWith('file:///doc/p1', 1));
});

test('renders nothing when parts is empty', async () => {
  const { queryByText } = await render(<RecordingsList parts={[]} />);
  expect(queryByText('段 1')).toBeNull();
});

test('shows a clear notice when the audio file is missing (not a dead player)', async () => {
  mockPartExists.mockResolvedValue(false);
  const { findByText, queryByTestId } = await render(<RecordingsList parts={[parts[0]]} />);
  await findByText('音檔不存在');
  expect(queryByTestId('play-0')).toBeNull(); // no transport on a missing file
});
