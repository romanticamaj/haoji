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
  await act(async () => { fireEvent.changeText(getByTestId('speaker-input-SPEAKER_01'), '建宏'); });
  await act(async () => { fireEvent.press(getByTestId('speakers-done')); });
  expect(onUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ names: expect.objectContaining({ SPEAKER_01: '建宏' }) }));
});

test('tapping the scrim dismisses the sheet without committing', async () => {
  const onUpdate = jest.fn();
  const { getByTestId, queryByTestId } = await render(<TranscriptTab session={base} onUpdate={onUpdate} />);
  await act(async () => { fireEvent.press(getByTestId('turn-head-SPEAKER_00')); });
  getByTestId('speaker-input-SPEAKER_00');
  await act(async () => { fireEvent.press(getByTestId('speakers-scrim')); });
  expect(queryByTestId('speaker-input-SPEAKER_00')).toBeNull();
  expect(onUpdate).not.toHaveBeenCalled();
});

// Diarisation regularly finds a dozen speakers. Hunting the transcript for one of them was the
// problem this sheet exists to solve, so it must list every speaker in one place.
const many: SavedSession = {
  ...base,
  names: {},
  transcript: {
    speakers: ['SPEAKER_00', 'SPEAKER_01', 'SPEAKER_02'],
    segments: [
      { start: 0, end: 2, speaker: 'SPEAKER_00', text: 'a' },     // 2s
      { start: 2, end: 32, speaker: 'SPEAKER_01', text: 'b' },    // 30s — talked the most
      { start: 32, end: 40, speaker: 'SPEAKER_02', text: 'c' },   // 8s
    ],
  },
};

test('the sheet lists every speaker with their speaking time, longest first', async () => {
  const { getByTestId, getAllByTestId, getByText } = await render(
    <TranscriptTab session={many} onUpdate={() => {}} />);
  await act(async () => { fireEvent.press(getByTestId('open-speakers')); });

  const rows = getAllByTestId(/^speaker-row-/);
  expect(rows.map((r) => r.props.testID)).toEqual([
    'speaker-row-SPEAKER_01', 'speaker-row-SPEAKER_02', 'speaker-row-SPEAKER_00',
  ]);
  getByText('說話 00:30 · 1 段');
});

test('the toolbar shows how many speakers still need naming', async () => {
  const { getByText } = await render(
    <TranscriptTab session={{ ...many, names: { SPEAKER_01: '建宏' } }} onUpdate={() => {}} />);
  getByText('講者 1/3');
});

// Naming eight people used to mean eight separate writes through eight separate sheets.
test('naming several speakers commits once, with all of them', async () => {
  const onUpdate = jest.fn();
  const { getByTestId } = await render(<TranscriptTab session={many} onUpdate={onUpdate} />);
  await act(async () => { fireEvent.press(getByTestId('open-speakers')); });
  await act(async () => { fireEvent.changeText(getByTestId('speaker-input-SPEAKER_01'), '建宏'); });
  await act(async () => { fireEvent.changeText(getByTestId('speaker-input-SPEAKER_00'), '郁婷'); });
  await act(async () => { fireEvent.press(getByTestId('speakers-done')); });

  expect(onUpdate).toHaveBeenCalledTimes(1);
  expect(onUpdate.mock.calls[0][0].names).toEqual({ SPEAKER_00: '郁婷', SPEAKER_01: '建宏' });
});

// Storing '' would render the speaker as a blank label rather than sending them back to 講者 N.
test('clearing a name removes it instead of storing an empty string', async () => {
  const onUpdate = jest.fn();
  const named = { ...many, names: { SPEAKER_01: '建宏' } };
  const { getByTestId } = await render(<TranscriptTab session={named} onUpdate={onUpdate} />);
  await act(async () => { fireEvent.press(getByTestId('open-speakers')); });
  await act(async () => { fireEvent.changeText(getByTestId('speaker-input-SPEAKER_01'), '  '); });
  await act(async () => { fireEvent.press(getByTestId('speakers-done')); });

  expect(onUpdate.mock.calls[0][0].names).toEqual({});
});

test('tapping a paragraph header opens the same sheet, focused on that speaker', async () => {
  const { getByTestId } = await render(<TranscriptTab session={many} onUpdate={() => {}} />);
  await act(async () => { fireEvent.press(getByTestId('turn-head-SPEAKER_02')); });
  expect(getByTestId('speaker-input-SPEAKER_02').props.autoFocus).toBe(true);
  getByTestId('speaker-input-SPEAKER_00');        // the others are right there too
});
