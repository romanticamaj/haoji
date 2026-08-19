import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
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
  fireEvent.press(getByText('生成逐字稿')); // draft/never-transcribed → "generate" (footer re-run stays "重新生成")
  expect(onRegenerate).toHaveBeenCalled();
  // no transcript paragraphs to show
  expect(queryByText('00:00')).toBeNull();
});

test('empty transcript but no parts: no regenerate button (nothing to re-run)', async () => {
  const s: SavedSession = { ...withParts({ speakers: [], segments: [] }), parts: [] };
  const { getByText, queryByText } = await render(
    <TranscriptTab session={s} onUpdate={() => {}} onRegenerate={() => {}} />);
  getByText(/找不到可辨識的錄音檔/);
  expect(queryByText('重新生成逐字稿')).toBeNull();
});

test('with transcript: shows a footer regenerate link that fires onRegenerate', async () => {
  const onRegenerate = jest.fn();
  const s = withParts({ speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好' }] });
  const { getByText } = await render(
    <TranscriptTab session={s} onUpdate={() => {}} onRegenerate={onRegenerate} />);
  getByText('你好'); // transcript rendered
  fireEvent.press(getByText('重新生成逐字稿'));
  expect(onRegenerate).toHaveBeenCalled();
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
  getByText('正在生成逐字稿');
  fireEvent.press(getByText('查看進度'));
  expect(onViewProgress).toHaveBeenCalled();
  expect(onRegenerate).not.toHaveBeenCalled();
});

test('job in flight WITH a transcript: footer offers 查看進度 instead of 重新生成', async () => {
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

test('no job: the normal 生成逐字稿 / 重新生成逐字稿 buttons are unchanged', async () => {
  const onRegenerate = jest.fn();
  const { getByText } = await render(
    <TranscriptTab session={withParts({ speakers: [], segments: [] })} onUpdate={() => {}}
      onRegenerate={onRegenerate} onViewProgress={() => {}} />);
  fireEvent.press(getByText('生成逐字稿'));
  expect(onRegenerate).toHaveBeenCalled();
});
