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
