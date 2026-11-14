import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { TranscribeButton, OFFLINE_NOTE, CONNECT_LABEL } from '../TranscribeButton';
import { transcribeGate, summarize } from '../../lib/serverStatus';

const status = require('../../../backend/tests/fixtures/contracts/status.json');

describe('transcribeGate', () => {
  test('unknown yet → ok (never block on a status that has not arrived)', () => {
    expect(transcribeGate(summarize(null), true)).toBe('ok');
  });
  test('unpaired / offline / ready', () => {
    expect(transcribeGate(summarize(null), false)).toBe('unpaired');
    expect(transcribeGate(summarize(null, new Error('x')), false)).toBe('offline');
    expect(transcribeGate(summarize(status), false)).toBe('ok');   // busy still accepts work
  });
});

test('copy', () => {
  expect(CONNECT_LABEL).toBe('連接主機後就能生成逐字稿');
  expect(OFFLINE_NOTE).toBe('主機沒有回應，錄音還在手機上。');
});

test('ok: the normal primary action', async () => {
  const onPress = jest.fn();
  const { getByRole, queryByText } = await render(
    <TranscribeButton gate="ok" label="生成逐字稿" onPress={onPress} onConnect={() => {}} />);
  await fireEvent.press(getByRole('button', { name: '生成逐字稿' }));
  expect(onPress).toHaveBeenCalled();
  expect(queryByText(OFFLINE_NOTE)).toBeNull();
});

test('unpaired: a secondary 「連接主機後就能生成逐字稿」 that opens Pair', async () => {
  const onPress = jest.fn();
  const onConnect = jest.fn();
  const { getByRole, queryByRole } = await render(
    <TranscribeButton gate="unpaired" label="生成逐字稿" onPress={onPress} onConnect={onConnect} />);
  expect(queryByRole('button', { name: '生成逐字稿' })).toBeNull();
  await fireEvent.press(getByRole('button', { name: CONNECT_LABEL }));
  expect(onConnect).toHaveBeenCalled();
  expect(onPress).not.toHaveBeenCalled();
});

test('offline: disabled, with the reassurance', async () => {
  const onPress = jest.fn();
  const { getByRole, getByText } = await render(
    <TranscribeButton gate="offline" label="生成逐字稿" onPress={onPress} onConnect={() => {}} />);
  const btn = getByRole('button', { name: '生成逐字稿' });
  expect(btn).toBeDisabled();
  await fireEvent.press(btn);
  expect(onPress).not.toHaveBeenCalled();
  getByText(OFFLINE_NOTE);
});
