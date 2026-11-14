import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(), keepLocalCopy: jest.fn(), types: { audio: 'a', video: 'v' },
  isErrorWithCode: () => false, errorCodes: { OPERATION_CANCELED: 'x' },
}));
jest.mock('react-native-image-picker', () => ({ launchImageLibrary: jest.fn() }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const React = require('react');
  // One stable object, as the real hook returns — effects keyed on `nav` must not re-run every render.
  const nav = { navigate: (...a: any[]) => mockNavigate(...a), addListener: () => () => {} };
  return {
    useNavigation: () => nav,
    useFocusEffect: (cb: () => any) => React.useEffect(cb, [cb]),
  };
});

import HomeScreen from '../HomeScreen';
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore } from '../../lib/store';
import * as server from '../../lib/server';
import * as config from '../../lib/config';

const status = require('../../../backend/tests/fixtures/contracts/status.json');
const green = { ...status, ok: true, checks: status.checks.map((c: any) => ({ ...c, ok: true })), queue: { active: 0, queued: 0 } };
const respond = (body: any) => { global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }) as any; };

beforeEach(async () => { jest.clearAllMocks(); await server.forgetServer(); });
afterEach(() => jest.restoreAllMocks());

const renderHome = async () => {
  const utils = await render(
    <SafeAreaProvider>
      <StoreProvider store={createMemoryStore()}><HomeScreen /></StoreProvider>
    </SafeAreaProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return utils;
};

test.each([
  ['ready', green, '主機已連線'],
  ['busy', { ...green, queue: { active: 1, queued: 0 } }, '主機忙碌中'],
])('the status dot label follows the tone (%s)', async (tone, body, label) => {
  respond(body);
  const { getByLabelText, getByTestId } = await renderHome();
  await waitFor(() => getByLabelText(`主機狀態：${label}`));
  getByTestId(`status-dot-${tone}`);
});

test('offline', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('down')) as any;
  const { getByLabelText, getByTestId } = await renderHome();
  await waitFor(() => getByLabelText('主機狀態：連不到主機'));
  getByTestId('status-dot-offline');
});

test('unpaired', async () => {
  jest.replaceProperty(config, 'API_BASE', null);
  const { getByLabelText } = await renderHome();
  await waitFor(() => getByLabelText('主機狀態：還沒連接主機'));
});

test('the status button sits next to search and opens Settings, even with no meetings', async () => {
  respond(green);
  const { getByLabelText } = await renderHome();
  await waitFor(() => getByLabelText('主機狀態：主機已連線'));
  await fireEvent.press(getByLabelText('主機狀態：主機已連線'));
  expect(mockNavigate).toHaveBeenCalledWith('Settings');
});
