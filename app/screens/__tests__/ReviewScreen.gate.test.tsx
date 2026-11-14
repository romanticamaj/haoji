import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

const mockReplace = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const React2 = require('react');
  const nav = {
    replace: (...a: any[]) => mockReplace(...a), navigate: (...a: any[]) => mockNavigate(...a),
    popToTop: jest.fn(), addListener: () => () => {},
  };
  return {
    useNavigation: () => nav,
    useRoute: () => ({ params: { sessionId: 'sess1' } }),
    useFocusEffect: (cb: () => void) => { React2.useEffect(cb, [cb]); },
  };
});

import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore, SavedSession } from '../../lib/store';
import * as server from '../../lib/server';
import * as config from '../../lib/config';
import ReviewScreen from '../ReviewScreen';

const status = require('../../../backend/tests/fixtures/contracts/status.json');
const session: SavedSession = {
  id: 'sess1', createdAt: 1, title: 't', unlocked: false, names: {},
  parts: [{ uri: 'haoji/sess1/part-0.wav', durationMs: 12000 }],
};

beforeEach(async () => { jest.clearAllMocks(); await server.forgetServer(); });
afterEach(() => jest.restoreAllMocks());

const renderReview = async () => {
  const utils = await render(<StoreProvider store={createMemoryStore([session])}><ReviewScreen /></StoreProvider>);
  await act(async () => { await new Promise<void>((r) => setTimeout(() => r(), 0)); });
  return utils;
};

test('paired and up: 生成逐字稿 starts processing', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => status }) as any;
  const { getByRole } = await renderReview();
  await fireEvent.press(getByRole('button', { name: '生成逐字稿' }));
  expect(mockReplace).toHaveBeenCalledWith('Processing', { sessionId: 'sess1', regen: false });
});

test('unpaired: the action becomes 連接主機後就能生成逐字稿 and opens Pair; the draft stays', async () => {
  jest.replaceProperty(config, 'API_BASE', null);
  const { getByRole, getByText } = await renderReview();
  await waitFor(() => getByRole('button', { name: '連接主機後就能生成逐字稿' }));
  await fireEvent.press(getByRole('button', { name: '連接主機後就能生成逐字稿' }));
  expect(mockNavigate).toHaveBeenCalledWith('Pair');
  expect(mockReplace).not.toHaveBeenCalled();
  getByText('稍後再說');   // saving the recording is still offered
});

test('offline: 生成逐字稿 is disabled with 「主機沒有回應，錄音還在手機上。」', async () => {
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as any;
  const { getByRole, getByText } = await renderReview();
  await waitFor(() => getByText('主機沒有回應，錄音還在手機上。'));
  expect(getByRole('button', { name: '生成逐字稿' })).toBeDisabled();
});
