import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import TranscriptTab from '../TranscriptTab';
import { SavedSession } from '../../lib/store';

const s: SavedSession = { id: 's', createdAt: 1, title: 't', unlocked: false,
  names: { SPEAKER_00: '' },
  transcript: { speakers: ['SPEAKER_00', 'SPEAKER_01'], segments: [
    { start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好' },
    { start: 2, end: 4, speaker: 'SPEAKER_01', text: '嗨' },
  ] } };

test('tapping a speaker row reveals an input; editing updates names', async () => {
  const onUpdate = jest.fn();
  const { getByText, getByTestId, queryByTestId } = await render(<TranscriptTab session={s} onUpdate={onUpdate} />);
  // editor is not open initially
  expect(queryByTestId('speaker-input-SPEAKER_00')).toBeNull();
  // tap the row for SPEAKER_00
  await fireEvent.press(getByTestId('speaker-row-SPEAKER_00'));
  const input = getByTestId('speaker-input-SPEAKER_00');
  fireEvent.changeText(input, 'Gary');
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ names: expect.objectContaining({ SPEAKER_00: 'Gary' }) }));
});

test('unnamed speaker shows the 點此命名 hint', async () => {
  const { getByText } = await render(<TranscriptTab session={s} onUpdate={() => {}} />);
  getByText('點此命名');
});
