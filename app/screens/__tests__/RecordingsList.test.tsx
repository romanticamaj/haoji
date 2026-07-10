import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { useAudioPlayer } from '@simform_solutions/react-native-audio-waveform';

// The native audio-waveform module is mocked globally in jest-setup.js: the Waveform ref's
// startPlayer/pausePlayer drive onPlayerStateChange, and useAudioPlayer() exposes a shared
// seekToPlayer spy we can assert on. Grab that spy here.
const { seekToPlayer } = useAudioPlayer();

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

test('pressing play starts playback and flips the control to pause', async () => {
  const { getByTestId, findByLabelText, getByLabelText } = await render(<RecordingsList parts={[parts[0]]} />);
  // wait for the existence check → waveform mounted
  await findByLabelText('waveform-/doc/p1');
  getByLabelText('播放');
  fireEvent.press(getByTestId('play-0'));
  await findByLabelText('暫停'); // startPlayer → onPlayerStateChange('playing')
});

test('skip forward/back seeks the player by clamped ms via the internal player key', async () => {
  const { getByLabelText, findByLabelText } = await render(<RecordingsList parts={[parts[0]]} />);
  await findByLabelText('waveform-/doc/p1');
  fireEvent.press(getByLabelText('快進 30 秒'));
  await waitFor(() => expect(seekToPlayer).toHaveBeenCalledWith({ playerKey: 'PlayerFor/doc/p1', progress: 30000 })); // 0 + 30000, within 61000
  // Skips are relative to the (optimistically updated) live position, so back-15 is now 30000 - 15000.
  fireEvent.press(getByLabelText('倒退 15 秒'));
  await waitFor(() => expect(seekToPlayer).toHaveBeenLastCalledWith({ playerKey: 'PlayerFor/doc/p1', progress: 15000 }));
});

test('speed button cycles 1.0× → 1.5× → 2.0× → 1.0×', async () => {
  const { getByText } = await render(<RecordingsList parts={[parts[0]]} />);
  getByText('1.0×');
  fireEvent.press(getByText('1.0×'));
  await waitFor(() => getByText('1.5×'));
  fireEvent.press(getByText('1.5×'));
  await waitFor(() => getByText('2.0×'));
  fireEvent.press(getByText('2.0×'));
  await waitFor(() => getByText('1.0×'));
});

test('renders nothing when parts is empty', async () => {
  const { queryByText } = await render(<RecordingsList parts={[]} />);
  expect(queryByText('段 1')).toBeNull();
});

test('shows a clear notice when the audio file is missing (not a dead player)', async () => {
  mockPartExists.mockResolvedValue(false);
  const { findByText, queryByTestId, queryByLabelText } = await render(<RecordingsList parts={[parts[0]]} />);
  await findByText('音檔不存在');
  expect(queryByTestId('play-0')).toBeNull();           // no transport on a missing file
  expect(queryByLabelText('waveform-/doc/p1')).toBeNull(); // and no waveform extraction attempted
});
