import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import TranscriptTab from '../TranscriptTab';
import { SavedSession } from '../../lib/store';

const session: SavedSession = {
  id: 's', createdAt: 1, title: 't', unlocked: false, names: {},
  transcript: { speakers: ['SPEAKER_00', 'SPEAKER_01'], segments: [
    { start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好' },
    { start: 2, end: 4, speaker: 'SPEAKER_00', text: '今天開會' },
    { start: 4, end: 6, speaker: 'SPEAKER_01', text: '好' },
  ] },
};

test('renders merged paragraphs with timestamps', async () => {
  const { getByText } = await render(<TranscriptTab session={session} onUpdate={() => {}} />);
  getByText('你好今天開會');
  getByText('00:00');
});

test('editing a speaker name via tap-to-edit calls onUpdate with names mapping', async () => {
  const onUpdate = jest.fn();
  const { getByTestId } = await render(<TranscriptTab session={session} onUpdate={onUpdate} />);
  await fireEvent.press(getByTestId('speaker-row-SPEAKER_00'));
  const input = getByTestId('speaker-input-SPEAKER_00');
  fireEvent.changeText(input, 'Gary');
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ names: expect.objectContaining({ SPEAKER_00: 'Gary' }) }));
});
