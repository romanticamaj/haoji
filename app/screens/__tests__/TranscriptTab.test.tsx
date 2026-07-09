import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
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

test('tapping a turn header opens the rename sheet; 完成 commits via onUpdate', async () => {
  const onUpdate = jest.fn();
  const { getByTestId, queryByTestId } = await render(
    <TranscriptTab session={session} onUpdate={onUpdate} />);
  // sheet not open initially
  expect(queryByTestId('rename-input-SPEAKER_00')).toBeNull();
  // tap the first speaker's turn header (state-changing press needs an act flush under React 19)
  await act(async () => { fireEvent.press(getByTestId('turn-head-SPEAKER_00')); });
  const input = getByTestId('rename-input-SPEAKER_00');
  await act(async () => { fireEvent.changeText(input, 'Gary'); });
  await act(async () => { fireEvent.press(getByTestId('rename-done-SPEAKER_00')); });
  expect(onUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ names: expect.objectContaining({ SPEAKER_00: 'Gary' }) }));
});
