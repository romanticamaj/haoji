import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import TranscriptTab from '../TranscriptTab';
import { SavedSession } from '../../lib/store';

const withParts = (transcript: SavedSession['transcript']): SavedSession => ({
  id: 's', createdAt: 1, title: 't', unlocked: false, names: {},
  transcript, parts: [{ uri: 'file:///p/part-0.m4a', durationMs: 1000 }],
});

test('empty transcript: shows generate CTA and fires onRegenerate', async () => {
  const onRegenerate = jest.fn();
  const s = withParts({ speakers: [], segments: [] });
  const { getByText, queryByText } = await render(
    <TranscriptTab session={s} onUpdate={() => {}} onRegenerate={onRegenerate} />);
  getByText('還沒有逐字稿');
  fireEvent.press(getByText('生成逐字稿')); // draft/never-transcribed → "generate" (the toolbar chip stays "重新生成")
  expect(onRegenerate).toHaveBeenCalled();
  // no transcript paragraphs to show
  expect(queryByText('00:00')).toBeNull();
});

test('empty transcript but no parts: no regenerate button (nothing to re-run)', async () => {
  const s: SavedSession = { ...withParts({ speakers: [], segments: [] }), parts: [] };
  const { getByText, queryByText } = await render(
    <TranscriptTab session={s} onUpdate={() => {}} onRegenerate={() => {}} />);
  getByText('這段錄音裡沒有可以辨識的聲音。');
  expect(queryByText('重新生成逐字稿')).toBeNull();
});

// Nothing exists to lose yet, so no dialog — but a double tap must not queue two jobs.
//
// Keep this ABOVE the tests that open the confirmation dialog: those leave a spied Alert and a
// rendered tree behind, and this one then fails to find its button — a harness artefact, not a
// defect in the screen.
test('first-time 生成逐字稿 needs no confirmation but still fires once', async () => {
  const onRegenerate = jest.fn();
  const s = withParts({ speakers: [], segments: [] });
  const { getByText } = await render(
    <TranscriptTab session={s} onUpdate={() => {}} onRegenerate={onRegenerate} />);

  await act(async () => { fireEvent.press(getByText('生成逐字稿')); });
  expect(onRegenerate).toHaveBeenCalledTimes(1);
  getByText('準備中…');
});

// While a transcription is in flight the "生成逐字稿" path must NOT be offered: it restarts the job
// from scratch (fresh backend session + full re-upload) and throws away work already done.
const busySession = (stage: 'uploading' | 'transcribing'): SavedSession => ({
  ...withParts({ speakers: [], segments: [] }),
  job: { stage, uploaded: 0, pct: 0.5, message: '辨識中…', updatedAt: 0 },
});

test('job in flight: empty state offers 查看進度, never 生成逐字稿', async () => {
  const onRegenerate = jest.fn();
  const onViewProgress = jest.fn();
  const { getByText, queryByText } = await render(
    <TranscriptTab session={busySession('transcribing')} onUpdate={() => {}}
      onRegenerate={onRegenerate} onViewProgress={onViewProgress} />);

  expect(queryByText('生成逐字稿')).toBeNull();      // the destructive restart is not reachable
  getByText('正在整理逐字稿…');
  fireEvent.press(getByText('查看進度'));
  expect(onViewProgress).toHaveBeenCalled();
  expect(onRegenerate).not.toHaveBeenCalled();
});

test('job in flight WITH a transcript: the toolbar offers 查看進度 instead of 重新生成', async () => {
  const onRegenerate = jest.fn();
  const onViewProgress = jest.fn();
  const s: SavedSession = {
    ...busySession('uploading'),
    transcript: { speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好' }] },
  };
  const { getByText, queryByText } = await render(
    <TranscriptTab session={s} onUpdate={() => {}} onRegenerate={onRegenerate} onViewProgress={onViewProgress} />);

  expect(queryByText('重新生成逐字稿')).toBeNull();
  fireEvent.press(getByText(/查看進度/));
  expect(onViewProgress).toHaveBeenCalled();
});

test('no job: the normal 生成逐字稿 button is unchanged', async () => {
  const onRegenerate = jest.fn();
  const { getByText } = await render(
    <TranscriptTab session={withParts({ speakers: [], segments: [] })} onUpdate={() => {}}
      onRegenerate={onRegenerate} onViewProgress={() => {}} />);
  fireEvent.press(getByText('生成逐字稿'));
  expect(onRegenerate).toHaveBeenCalled();
});

// 重新生成逐字稿 lives only in Results' `…` menu now (issue #32 item 4): its confirmation, cancel and
// one-run guard are covered in ResultsScreen.restructure.test.tsx. The toolbar keeps 講者, 複製 and the
// contextual chips (查看進度, 連接主機) on one row that does not scroll.
test('the toolbar has no 重新生成逐字稿 chip, only 講者 and 複製, on a non-scrolling row', async () => {
  const s = withParts({ speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好' }] });
  const { getByTestId, queryByTestId, queryByText } = await render(
    <TranscriptTab session={s} onUpdate={() => {}} onRegenerate={() => {}} />);
  expect(queryByTestId('regenerate-transcript')).toBeNull();
  expect(queryByText('重新生成逐字稿')).toBeNull();
  const row = getByTestId('transcript-toolbar');
  expect(row.props.horizontal).toBeUndefined();
  getByTestId('copy-transcript');
  getByTestId('open-speakers');
});

test('unpaired: the toolbar still offers 連接主機', async () => {
  const onConnect = jest.fn();
  const s = withParts({ speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好' }] });
  const { getByTestId } = await render(
    <TranscriptTab session={s} onUpdate={() => {}} onRegenerate={() => {}} gate="unpaired" onConnect={onConnect} />);
  fireEvent.press(getByTestId('connect-server'));
  expect(onConnect).toHaveBeenCalled();
});
