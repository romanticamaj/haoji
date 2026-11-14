import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, act, within } from '@testing-library/react-native';
import TranscriptTab from '../TranscriptTab';
import { SavedSession } from '../../lib/store';
import { fontScale, speakerColor } from '../../lib/theme';

// Two speakers, alternating, so each one has a first turn and a later turn.
const session: SavedSession = {
  id: 's', createdAt: 1, title: 't', unlocked: false, names: {},
  transcript: { speakers: ['SPEAKER_00', 'SPEAKER_01'], segments: [
    { start: 0, end: 2, speaker: 'SPEAKER_00', text: '第一段' },
    { start: 2, end: 4, speaker: 'SPEAKER_01', text: '第二段' },
    { start: 4, end: 6, speaker: 'SPEAKER_00', text: '第三段' },
    { start: 6, end: 8, speaker: 'SPEAKER_01', text: '第四段' },
  ] },
  parts: [],
};

const bg = (el: any) => StyleSheet.flatten(el.props.style)?.backgroundColor;

test('the 點一下命名 chip appears only on each speaker\'s first turn', async () => {
  const { getAllByText, getByTestId } = await render(<TranscriptTab session={session} onUpdate={() => {}} />);
  expect(getAllByText(/點一下命名/).length).toBe(2);           // one per speaker, not one per turn
  within(getByTestId('turn-head-SPEAKER_00')).getByText(/點一下命名/);
  within(getByTestId('turn-head-SPEAKER_01')).getByText(/點一下命名/);
  // Later turns just say who it is.
  expect(within(getByTestId('turn-head-SPEAKER_00-2')).queryByText(/點一下命名/)).toBeNull();
  within(getByTestId('turn-head-SPEAKER_00-2')).getByText('講者 1');
  within(getByTestId('turn-head-SPEAKER_01-3')).getByText('講者 2');
});

test('every speaker avatar wears its palette colour, named or not', async () => {
  const { getByTestId, rerender } = await render(<TranscriptTab session={session} onUpdate={() => {}} />);
  expect(bg(getByTestId('turn-avatar-0'))).toBe(speakerColor(0));
  expect(bg(getByTestId('turn-avatar-1'))).toBe(speakerColor(1));
  expect(bg(getByTestId('turn-avatar-2'))).toBe(speakerColor(0));
  await act(async () => {
    rerender(<TranscriptTab session={{ ...session, names: { SPEAKER_01: '建宏' } }} onUpdate={() => {}} />);
  });
  expect(bg(getByTestId('turn-avatar-1'))).toBe(speakerColor(1));
});

test('speaker chips read their state and what a double tap does', async () => {
  const { getByTestId, rerender } = await render(<TranscriptTab session={session} onUpdate={() => {}} />);
  expect(getByTestId('turn-head-SPEAKER_00').props.accessibilityLabel).toBe('講者 1，還沒命名，點兩下命名');
  expect(getByTestId('turn-head-SPEAKER_01-3').props.accessibilityLabel).toBe('講者 2，還沒命名，點兩下命名');
  await act(async () => {
    rerender(<TranscriptTab session={{ ...session, names: { SPEAKER_00: '郁婷' } }} onUpdate={() => {}} />);
  });
  expect(getByTestId('turn-head-SPEAKER_00').props.accessibilityLabel).toBe('郁婷，點兩下改名');
});

test('the speaker chip still opens the sheet focused on that speaker', async () => {
  const { getByTestId } = await render(<TranscriptTab session={session} onUpdate={() => {}} />);
  await act(async () => { fireEvent.press(getByTestId('turn-head-SPEAKER_01-3')); });
  expect(getByTestId('speaker-input-SPEAKER_01').props.autoFocus).toBe(true);
});

test('a transcript turn offers 從這裡播放 as an accessibility action that seeks', async () => {
  const onSeek = jest.fn();
  const { getByTestId } = await render(<TranscriptTab session={session} onUpdate={() => {}} onSeek={onSeek} />);
  const body = getByTestId('turn-body-2');
  expect(body.props.accessibilityActions).toEqual(expect.arrayContaining([{ name: 'activate', label: '從這裡播放' }]));
  await act(async () => { fireEvent(body, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } }); });
  expect(onSeek).toHaveBeenCalledWith(4000);
});

test('the speakers chip is an avatar stack with the named count', async () => {
  const { getByTestId } = await render(
    <TranscriptTab session={{ ...session, names: { SPEAKER_00: '郁婷' } }} onUpdate={() => {}} />);
  const stack = getByTestId('open-speakers');
  expect(stack.props.accessibilityLabel).toBe('管理講者，2 位，已命名 1 位');
  expect(bg(within(stack).getByTestId('stack-avatar-SPEAKER_00'))).toBe(speakerColor(0));
  expect(bg(within(stack).getByTestId('stack-avatar-SPEAKER_01'))).toBe(speakerColor(1));
  within(stack).getByText('講者 1/2');
});

test('transcript text may grow to the content ceiling; chrome stops at the chrome ceiling', async () => {
  const { getByText, getByTestId } = await render(<TranscriptTab session={session} onUpdate={() => {}} />);
  expect(getByText('第一段').props.maxFontSizeMultiplier).toBe(fontScale.content);
  expect(within(getByTestId('turn-head-SPEAKER_00')).getByText('00:00').props.maxFontSizeMultiplier).toBe(fontScale.chrome);
  expect(within(getByTestId('turn-head-SPEAKER_00')).getByText(/點一下命名/).props.maxFontSizeMultiplier).toBe(fontScale.chrome);
});
