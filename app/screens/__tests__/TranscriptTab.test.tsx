import React from 'react';
import { render, fireEvent, act, within } from '@testing-library/react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import TranscriptTab from '../TranscriptTab';
import { SavedSession } from '../../lib/store';

const session: SavedSession = {
  id: 's', createdAt: 1, title: 't', unlocked: false, names: {},
  transcript: { speakers: ['SPEAKER_00', 'SPEAKER_01'], segments: [
    { start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好' },
    { start: 2, end: 4, speaker: 'SPEAKER_00', text: '今天開會' },
    { start: 4, end: 6, speaker: 'SPEAKER_01', text: '好' },
  ] },
  parts: [],
};

test('renders merged paragraphs with timestamps', async () => {
  const { getByText } = await render(<TranscriptTab session={session} onUpdate={() => {}} />);
  getByText('你好今天開會');
  getByText('00:00');
});

test('複製 copies the formatted transcript to the clipboard', async () => {
  const { getByTestId } = await render(<TranscriptTab session={session} onUpdate={() => {}} />);
  await act(async () => { fireEvent.press(getByTestId('copy-transcript')); });
  expect(Clipboard.setString).toHaveBeenCalledWith('[00:00] SPEAKER_00\n你好今天開會\n\n[00:04] SPEAKER_01\n好');
});

test('tapping a paragraph body seeks the player to that paragraph start (ms) via onSeek', async () => {
  const onSeek = jest.fn();
  const { getByTestId } = await render(
    <TranscriptTab session={session} onUpdate={() => {}} onSeek={onSeek} />);
  await act(async () => { fireEvent.press(getByTestId('turn-body-0')); }); // SPEAKER_00 paragraph, start 0
  expect(onSeek).toHaveBeenCalledWith(0);
  await act(async () => { fireEvent.press(getByTestId('turn-body-1')); }); // SPEAKER_01 paragraph, start 4s
  expect(onSeek).toHaveBeenLastCalledWith(4000);
});

test('follow-along: activeMs highlights the paragraph being played; 0 highlights none', async () => {
  const { getByTestId, queryByTestId, rerender } = await render(
    <TranscriptTab session={session} onUpdate={() => {}} activeMs={0} />);
  expect(queryByTestId('turn-active')).toBeNull(); // not playing → nothing highlighted
  // 5s falls in the SPEAKER_01 paragraph (starts at 4s)
  await act(async () => { rerender(<TranscriptTab session={session} onUpdate={() => {}} activeMs={5000} />); });
  within(getByTestId('turn-active')).getByText('好');
  // 1s falls in the first paragraph
  await act(async () => { rerender(<TranscriptTab session={session} onUpdate={() => {}} activeMs={1000} />); });
  within(getByTestId('turn-active')).getByText('你好今天開會');
});

test('long-pressing a paragraph inline-edits it; 完成 writes the correction back to the segments', async () => {
  const onUpdate = jest.fn();
  const { getByTestId, queryByTestId } = await render(
    <TranscriptTab session={session} onUpdate={onUpdate} />);
  expect(queryByTestId('edit-input-0')).toBeNull();
  await act(async () => { fireEvent(getByTestId('turn-body-0'), 'longPress'); });
  const input = getByTestId('edit-input-0');
  await act(async () => { fireEvent.changeText(input, '你好，今天要開會'); });
  await act(async () => { fireEvent.press(getByTestId('edit-done-0')); });
  // paragraph 0 spanned segments 0..1 → collapsed into one corrected segment (start/end/speaker kept)
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
    transcript: expect.objectContaining({
      segments: [
        { start: 0, end: 4, speaker: 'SPEAKER_00', text: '你好，今天要開會' },
        { start: 4, end: 6, speaker: 'SPEAKER_01', text: '好' },
      ],
    }),
  }));
});

test('inline edit 取消 discards without calling onUpdate', async () => {
  const onUpdate = jest.fn();
  const { getByTestId, queryByTestId } = await render(
    <TranscriptTab session={session} onUpdate={onUpdate} />);
  await act(async () => { fireEvent(getByTestId('turn-body-0'), 'longPress'); });
  await act(async () => { fireEvent.changeText(getByTestId('edit-input-0'), 'nope'); });
  await act(async () => { fireEvent.press(getByTestId('edit-cancel-0')); });
  expect(onUpdate).not.toHaveBeenCalled();
  expect(queryByTestId('edit-input-0')).toBeNull();
});

test('tapping a turn header opens the rename sheet; 完成 commits via onUpdate', async () => {
  const onUpdate = jest.fn();
  const { getByTestId, queryByTestId } = await render(
    <TranscriptTab session={session} onUpdate={onUpdate} />);
  // sheet not open initially
  expect(queryByTestId('speaker-input-SPEAKER_00')).toBeNull();
  // tap the first speaker's turn header (state-changing press needs an act flush under React 19)
  await act(async () => { fireEvent.press(getByTestId('turn-head-SPEAKER_00')); });
  const input = getByTestId('speaker-input-SPEAKER_00');
  await act(async () => { fireEvent.changeText(input, 'Gary'); });
  await act(async () => { fireEvent.press(getByTestId('speakers-done')); });
  expect(onUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ names: expect.objectContaining({ SPEAKER_00: 'Gary' }) }));
});

// Deleting from inside a meeting: one outline danger button, always the last thing on the page.
test('刪除這場會議 sits at the end of the transcript and hands off to the confirm', async () => {
  const onDelete = jest.fn();
  const { getByText } = await render(<TranscriptTab session={session} onUpdate={() => {}} onDelete={onDelete} />);
  fireEvent.press(getByText('刪除這場會議'));
  expect(onDelete).toHaveBeenCalledTimes(1);
});
