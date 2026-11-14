import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import { MiniPlayer } from '../MiniPlayer';

const base = {
  playing: false, positionMs: 65000, totalMs: 600000, speed: 1,
  onToggle: jest.fn(), onCycleSpeed: jest.fn(), onExpandChange: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

test('collapsed bar shows play, the time and the speed', async () => {
  const { getByTestId, getByText, getByRole } = await render(
    <MiniPlayer {...base} expanded={false}><Text>card</Text></MiniPlayer>);
  expect(getByTestId('mini-play').props.accessibilityLabel).toBe('播放');
  getByText('01:05 / 10:00');
  getByRole('button', { name: '播放速度 1.0×' });
});

test('play/pause and speed call through', async () => {
  const { getByTestId, getByRole, rerender } = await render(
    <MiniPlayer {...base} expanded={false}><Text>card</Text></MiniPlayer>);
  await fireEvent.press(getByTestId('mini-play'));
  expect(base.onToggle).toHaveBeenCalledTimes(1);
  await fireEvent.press(getByRole('button', { name: '播放速度 1.0×' }));
  expect(base.onCycleSpeed).toHaveBeenCalledTimes(1);
  await act(async () => { rerender(<MiniPlayer {...base} playing speed={1.5} expanded={false}><Text>card</Text></MiniPlayer>); });
  expect(getByTestId('mini-play').props.accessibilityLabel).toBe('暫停');
  getByRole('button', { name: '播放速度 1.5×' });
});

test('tapping the bar asks to expand; the card stays mounted but hidden while collapsed', async () => {
  const { getByTestId, getByText } = await render(
    <MiniPlayer {...base} expanded={false}><Text>card</Text></MiniPlayer>);
  // Mounted even when collapsed: the native player lives inside it and must keep playing.
  getByText('card', { includeHiddenElements: true });
  expect(getByTestId('mini-card', { includeHiddenElements: true }).props.accessibilityElementsHidden).toBe(true);
  const bar = getByTestId('mini-expand');
  expect(bar.props.accessibilityState).toEqual(expect.objectContaining({ expanded: false }));
  await fireEvent.press(bar);
  expect(base.onExpandChange).toHaveBeenCalledWith(true);
});

test('expanded shows the card and a way back to the bar', async () => {
  const { getByTestId, getByRole, queryByTestId } = await render(
    <MiniPlayer {...base} expanded><Text>card</Text></MiniPlayer>);
  expect(getByTestId('mini-card').props.accessibilityElementsHidden).toBe(false);
  expect(queryByTestId('mini-expand')).toBeNull();
  await fireEvent.press(getByRole('button', { name: '收合播放器' }));
  expect(base.onExpandChange).toHaveBeenCalledWith(false);
});

test('the scrub line reflects how far along playback is', async () => {
  const { getByTestId } = await render(
    <MiniPlayer {...base} positionMs={150000} totalMs={600000} expanded={false}><Text>card</Text></MiniPlayer>);
  const line = getByTestId('mini-progress');
  expect(line.props.accessibilityRole).toBe('progressbar');
  expect(line.props.accessibilityValue).toEqual({ min: 0, max: 600, now: 150 });
});

test('unknown length shows --:-- instead of a fake 00:00', async () => {
  const { getByText } = await render(
    <MiniPlayer {...base} positionMs={0} totalMs={0} expanded={false}><Text>card</Text></MiniPlayer>);
  getByText('00:00 / --:--');
});
