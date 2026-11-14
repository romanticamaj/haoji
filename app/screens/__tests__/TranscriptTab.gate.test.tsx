import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import TranscriptTab from '../TranscriptTab';
import { SavedSession } from '../../lib/store';

const withParts = (segments: any[]): SavedSession => ({
  id: 's', createdAt: 1, title: 't', unlocked: false, names: {},
  transcript: { speakers: segments.length ? ['SPEAKER_00'] : [], segments },
  parts: [{ uri: 'file:///p/part-0.m4a', durationMs: 1000 }],
});
const seg = [{ start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好' }];

test('no transcript, unpaired: offers to connect instead of generating', async () => {
  const onRegenerate = jest.fn();
  const onConnect = jest.fn();
  const { getByRole, queryByRole } = await render(
    <TranscriptTab session={withParts([])} onUpdate={() => {}} onRegenerate={onRegenerate} gate="unpaired" onConnect={onConnect} />);
  expect(queryByRole('button', { name: '生成逐字稿' })).toBeNull();
  await fireEvent.press(getByRole('button', { name: '連接主機後就能生成逐字稿' }));
  expect(onConnect).toHaveBeenCalled();
  expect(onRegenerate).not.toHaveBeenCalled();
});

test('no transcript, offline: generate is disabled with the reassurance', async () => {
  const onRegenerate = jest.fn();
  const { getByRole, getByText } = await render(
    <TranscriptTab session={withParts([])} onUpdate={() => {}} onRegenerate={onRegenerate} gate="offline" />);
  expect(getByRole('button', { name: '生成逐字稿' })).toBeDisabled();
  getByText('主機沒有回應，錄音還在手機上。');
});

test('with transcript, offline: the transcript still shows and 重新生成 is disabled', async () => {
  const { getByText, getByRole } = await render(
    <TranscriptTab session={withParts(seg)} onUpdate={() => {}} onRegenerate={() => {}} gate="offline" />);
  getByText('你好');
  expect(getByRole('button', { name: '重新生成逐字稿' })).toBeDisabled();
});

test('with transcript, unpaired: the chip offers to connect', async () => {
  const onConnect = jest.fn();
  const { getByText, getByRole } = await render(
    <TranscriptTab session={withParts(seg)} onUpdate={() => {}} onRegenerate={() => {}} gate="unpaired" onConnect={onConnect} />);
  getByText('你好');
  await fireEvent.press(getByRole('button', { name: '連接主機' }));
  expect(onConnect).toHaveBeenCalled();
});
