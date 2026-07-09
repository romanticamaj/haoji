import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import TranscriptTab from '../TranscriptTab';
import { SavedSession } from '../../lib/store';

const base: SavedSession = {
  id: 's', createdAt: 1, title: 't', unlocked: false,
  names: { SPEAKER_00: '' },
  transcript: { speakers: ['SPEAKER_00', 'SPEAKER_01'], segments: [
    { start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好' },
    { start: 2, end: 4, speaker: 'SPEAKER_01', text: '嗨' },
  ] }, parts: [],
};

test('unnamed speakers show a dashed "點一下命名" chip (incl. ones absent from names map)', async () => {
  // SPEAKER_00 has '' in names; SPEAKER_01 is absent from names — BOTH must prompt as tappable.
  const { getAllByText } = await render(<TranscriptTab session={base} onUpdate={() => {}} />);
  expect(getAllByText(/點一下命名/).length).toBe(2);
});

test('named speaker shows the plain avatar+name instead of the dashed chip', async () => {
  const named: SavedSession = { ...base, names: { SPEAKER_00: '郁婷', SPEAKER_01: '建宏' } };
  const { getByText, queryByText } = await render(<TranscriptTab session={named} onUpdate={() => {}} />);
  getByText('郁婷');
  getByText('建宏');
  expect(queryByText(/點一下命名/)).toBeNull();
});

test('rename flow: tap header → type → 完成 puts the new name in names', async () => {
  const onUpdate = jest.fn();
  const { getByTestId } = await render(<TranscriptTab session={base} onUpdate={onUpdate} />);
  await act(async () => { fireEvent.press(getByTestId('turn-head-SPEAKER_01')); });
  await act(async () => { fireEvent.changeText(getByTestId('rename-input-SPEAKER_01'), '建宏'); });
  await act(async () => { fireEvent.press(getByTestId('rename-done-SPEAKER_01')); });
  expect(onUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ names: expect.objectContaining({ SPEAKER_01: '建宏' }) }));
});

test('tapping the scrim dismisses the sheet without committing', async () => {
  const onUpdate = jest.fn();
  const { getByTestId, queryByTestId } = await render(<TranscriptTab session={base} onUpdate={onUpdate} />);
  await act(async () => { fireEvent.press(getByTestId('turn-head-SPEAKER_00')); });
  getByTestId('rename-input-SPEAKER_00');
  await act(async () => { fireEvent.press(getByTestId('rename-scrim')); });
  expect(queryByTestId('rename-input-SPEAKER_00')).toBeNull();
  expect(onUpdate).not.toHaveBeenCalled();
});
