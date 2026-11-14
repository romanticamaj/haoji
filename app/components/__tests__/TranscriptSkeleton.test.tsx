import React from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { TranscriptSkeleton } from '../TranscriptSkeleton';
import { MiniPlayer } from '../MiniPlayer';
import { colors } from '../../lib/theme';

// Issue #32 item 8: Results shows six placeholder turns while it loads instead of a spinner, and
// they hold still under Reduce Motion.
afterEach(() => jest.restoreAllMocks());

test('six skeleton turns, announced as loading', async () => {
  const { getAllByTestId, getByLabelText } = await render(<TranscriptSkeleton />);
  expect(getAllByTestId('skeleton-turn')).toHaveLength(6);
  getByLabelText('正在載入逐字稿…');
});

test('pulses normally', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  const loop = jest.spyOn(Animated, 'loop');
  await render(<TranscriptSkeleton />);
  await act(async () => { await Promise.resolve(); });
  expect(loop).toHaveBeenCalled();
});

test('holds still under Reduce Motion', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  // Count loops that are running: started and not stopped.
  let running = 0;
  jest.spyOn(Animated, 'loop').mockImplementation(() => {
    let on = false;
    return {
      start: () => { if (!on) { on = true; running++; } },
      stop: () => { if (on) { on = false; running--; } },
      reset: () => {},
    } as any;
  });
  await render(<TranscriptSkeleton />);
  await act(async () => { await Promise.resolve(); });
  expect(running).toBe(0);
});

test('the mini player dock is surface, with a 4 pt progress track', async () => {
  const { getByTestId } = await render(
    <MiniPlayer playing={false} positionMs={0} totalMs={1000} speed={1} expanded={false}
      onToggle={() => {}} onCycleSpeed={() => {}} onExpandChange={() => {}}><Text>card</Text></MiniPlayer>);
  expect(StyleSheet.flatten(getByTestId('mini-dock').props.style).backgroundColor).toBe(colors.surface);
  expect(StyleSheet.flatten(getByTestId('mini-progress').props.style).height).toBe(4);
});
