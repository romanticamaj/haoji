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
  getByText(/找不到可辨識的錄音檔/);
  expect(queryByText('重新生成逐字稿')).toBeNull();
});

test('with transcript: confirming from the toolbar chip fires onRegenerate', async () => {
  const onRegenerate = jest.fn();
  const s = withParts({ speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好' }] });
  const { getByText } = await render(
    <TranscriptTab session={s} onUpdate={() => {}} onRegenerate={onRegenerate} />);
  getByText('你好'); // transcript rendered
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  fireEvent.press(getByText('重新生成逐字稿'));
  (spy.mock.calls[0] as any[])[2][1].onPress();      // 重新生成
  expect(onRegenerate).toHaveBeenCalled();
  spy.mockRestore();
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
  getByText('正在生成逐字稿');
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

test('no job: the normal 生成逐字稿 / 重新生成逐字稿 buttons are unchanged', async () => {
  const onRegenerate = jest.fn();
  const { getByText } = await render(
    <TranscriptTab session={withParts({ speakers: [], segments: [] })} onUpdate={() => {}}
      onRegenerate={onRegenerate} onViewProgress={() => {}} />);
  fireEvent.press(getByText('生成逐字稿'));
  expect(onRegenerate).toHaveBeenCalled();
});

// 重新生成逐字稿 used to sit at the BOTTOM of the transcript: on a long meeting that meant scrolling
// past every paragraph to reach it. It now lives in the persistent toolbar, like the analysis tab's
// actions — visible without scrolling, next to 講者 and 複製.
test('重新生成逐字稿 sits in the toolbar, alongside 講者 and 複製', async () => {
  const onRegenerate = jest.fn();
  const s = withParts({ speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好' }] });
  const { getByTestId } = await render(
    <TranscriptTab session={s} onUpdate={() => {}} onRegenerate={onRegenerate} />);

  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  fireEvent.press(getByTestId('regenerate-transcript'));
  (spy.mock.calls[0] as any[])[2][1].onPress();      // 重新生成
  expect(onRegenerate).toHaveBeenCalled();
  getByTestId('copy-transcript');          // the toolbar it shares
  getByTestId('open-speakers');
  spy.mockRestore();
});

// Re-running the transcript is destructive in a way regenerating the notes is not: the notes are
// archived to 版本紀錄 first, a transcript is simply overwritten — inline text corrections included.
test('重新生成逐字稿 asks first, and says the current transcript cannot be recovered', async () => {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const onRegenerate = jest.fn();
  const s = withParts({ speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好' }] });
  const { getByTestId } = await render(
    <TranscriptTab session={s} onUpdate={() => {}} onRegenerate={onRegenerate} />);

  fireEvent.press(getByTestId('regenerate-transcript'));
  expect(onRegenerate).not.toHaveBeenCalled();               // nothing happens without confirming

  const [title, body, buttons] = spy.mock.calls[0] as any[];
  expect(title).toMatch(/重新生成逐字稿/);
  expect(body).toMatch(/無法還原/);
  buttons[1].onPress();
  expect(onRegenerate).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});

test('cancelling leaves the transcript alone', async () => {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const onRegenerate = jest.fn();
  const s = withParts({ speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好' }] });
  const { getByTestId } = await render(
    <TranscriptTab session={s} onUpdate={() => {}} onRegenerate={onRegenerate} />);

  fireEvent.press(getByTestId('regenerate-transcript'));
  const [, , buttons] = spy.mock.calls[0] as any[];
  buttons[0].onPress?.();                                    // 取消
  expect(onRegenerate).not.toHaveBeenCalled();
  spy.mockRestore();
});

// The screen is replaced by 分析中 right after, but a second tap lands inside that window.
test('confirming twice still starts only one run', async () => {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const onRegenerate = jest.fn();
  const s = withParts({ speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好' }] });
  const { getByTestId } = await render(
    <TranscriptTab session={s} onUpdate={() => {}} onRegenerate={onRegenerate} />);

  fireEvent.press(getByTestId('regenerate-transcript'));
  await act(async () => { (spy.mock.calls[0] as any[])[2][1].onPress(); });
  fireEvent.press(getByTestId('regenerate-transcript'));     // second tap before the screen changes
  fireEvent.press(getByTestId('regenerate-transcript'));

  expect(onRegenerate).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledTimes(1);                      // and no second dialog
  spy.mockRestore();
});
