import React from 'react';
import { Alert, Linking, ScrollView, StyleSheet } from 'react-native';
import { render, fireEvent, act, waitFor, within } from '@testing-library/react-native';
import { colors } from '../../lib/theme';

const mockNavigate = jest.fn();
let mockParams: any;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, addListener: () => () => {} }),
  useRoute: () => ({ params: mockParams }),
}));

import SettingsScreen from '../SettingsScreen';
import * as server from '../../lib/server';
import * as config from '../../lib/config';

const status = require('../../../backend/tests/fixtures/contracts/status.json');
const green = { ...status, ok: true, checks: status.checks.map((c: any) => ({ ...c, ok: true })), queue: { active: 0, queued: 0 } };
const respond = (body: any) => { global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }) as any; };

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = undefined;
  await server.forgetServer();
});
afterEach(() => jest.restoreAllMocks());

const renderSettings = async () => {
  const utils = await render(<SettingsScreen />);
  // Let the first status request settle (several awaits deep) inside act.
  await act(async () => { await new Promise<void>((r) => setTimeout(() => r(), 0)); });
  return utils;
};

test('ready: shows the server address, latency and phone-word status rows', async () => {
  await server.saveServer({ url: 'http://box:7780', token: 't', pairedAt: 1 });
  respond(green);
  const { getByText, getAllByText, getByLabelText } = await renderSettings();
  await waitFor(() => getByText('主機已連線'));
  getByText('http://box:7780');
  getByText(/\d+ ms/);
  // 狀態 rows: muted label on the left, dot + value on the right (issue #32 item 7).
  getByLabelText('語音辨識：正常');
  getByLabelText('會議記錄：正常');
  getByText('語音辨識');
  getAllByText('正常');
  getByText('目前沒有在整理的錄音。');
  getByLabelText('主機狀態：主機已連線');
  getByText('錄音只在處理時傳到你的主機，處理完就刪除。');
});

test('busy: the contract fixture (one job running, notes not ready)', async () => {
  await server.saveServer({ url: 'http://box:7780', pairedAt: 1 });
  respond(status);
  const { getByText, getByLabelText } = await renderSettings();
  await waitFor(() => getByText('主機忙碌中'));
  getByLabelText('會議記錄：還沒準備好');
  getByText('處理中 1 場，排隊中 0 場');
});

test('offline: the server does not answer', async () => {
  await server.saveServer({ url: 'http://box:7780', pairedAt: 1 });
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as any;
  const { getByText } = await renderSettings();
  await waitFor(() => getByText('連不到主機'));
  getByText('http://box:7780');
  getByText('重新配對');
});

test('unpaired: 連接主機 is the primary action and opens Pair', async () => {
  jest.replaceProperty(config, 'API_BASE', null);
  global.fetch = jest.fn() as any;
  const { getByText, getByRole, queryByText } = await renderSettings();
  await waitFor(() => getByText('連接主機'));
  getByText('連接你的主機後，就能生成逐字稿。');
  expect(queryByText('中斷連線')).toBeNull();
  expect(queryByText('重新配對')).toBeNull();
  await fireEvent.press(getByRole('button', { name: '連接主機' }));
  expect(mockNavigate).toHaveBeenCalledWith('Pair');
});

test('重新配對 opens Pair', async () => {
  await server.saveServer({ url: 'http://box:7780', pairedAt: 1 });
  respond(green);
  const { getByRole } = await renderSettings();
  await fireEvent.press(getByRole('button', { name: '重新配對' }));
  expect(mockNavigate).toHaveBeenCalledWith('Pair');
});

test('forget asks for confirmation, then clears the server', async () => {
  await server.saveServer({ url: 'http://box:7780', pairedAt: 1 });
  respond(green);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { getByRole } = await renderSettings();
  await fireEvent.press(getByRole('button', { name: '中斷連線' }));
  expect(alert).toHaveBeenCalledTimes(1);
  const [title, body, buttons] = alert.mock.calls[0] as any;
  expect(title).toBe('中斷和這台主機的連線？');
  expect(body).toBe('手機上的錄音和會議記錄都會留著。');
  expect(buttons.map((b: any) => b.text)).toEqual(['取消', '中斷連線']);
  expect(buttons.map((b: any) => b.text)).not.toContain('確定');
  expect(await server.loadServer()).not.toBeNull();     // nothing happens before confirming
  // Forgetting notifies the status hook, which re-checks; let that settle inside act too.
  await act(async () => { await buttons[1].onPress(); await new Promise<void>((r) => setTimeout(() => r(), 0)); });
  expect(await server.loadServer()).toBeNull();
});

test('中斷連線 is a danger text button, not an outlined one', async () => {
  await server.saveServer({ url: 'http://box:7780', pairedAt: 1 });
  respond(green);
  const { getByRole } = await renderSettings();
  const btn = getByRole('button', { name: '中斷連線' });
  const st = StyleSheet.flatten(btn.props.style) ?? {};
  expect(st.borderWidth ?? 0).toBe(0);
  expect(within(btn).getByText('中斷連線')).toHaveStyle({ color: colors.danger });
});

test('no 中斷連線 when the address comes from the build, not from pairing', async () => {
  respond(green);   // jest-setup gives a build-time API_BASE
  const { getByText, queryByText } = await renderSettings();
  await waitFor(() => getByText('主機已連線'));
  expect(queryByText('中斷連線')).toBeNull();
});

// Issue #32 item 6: Home's status badge opens Settings with focus: 'status' and lands on 狀態.
test('focus: status scrolls to the 狀態 card once it is laid out', async () => {
  const scrollTo = (ScrollView as any).prototype.scrollTo as jest.Mock;
  respond(green);
  mockParams = { focus: 'status' };
  const { getByTestId } = await renderSettings();
  scrollTo.mockClear();
  await act(async () => { fireEvent(getByTestId('settings-card-status'), 'layout', { nativeEvent: { layout: { x: 0, y: 320, width: 300, height: 100 } } }); });
  expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: expect.any(Number) }));
  expect(scrollTo.mock.calls[0][0].y).toBeGreaterThan(0);
});

test('without focus, Settings opens at the top', async () => {
  const scrollTo = (ScrollView as any).prototype.scrollTo as jest.Mock;
  respond(green);
  const { getByTestId } = await renderSettings();
  scrollTo.mockClear();
  await act(async () => { fireEvent(getByTestId('settings-card-status'), 'layout', { nativeEvent: { layout: { x: 0, y: 320, width: 300, height: 100 } } }); });
  expect(scrollTo).not.toHaveBeenCalled();
});

test('關於 shows the version and opens the source link', async () => {
  respond(green);
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
  const { getByText, getByRole } = await renderSettings();
  getByText(`版本 ${require('../../package.json').version}`);
  await fireEvent.press(getByRole('link', { name: '在 GitHub 看原始碼' }));
  expect(open).toHaveBeenCalledWith(expect.stringContaining('github.com'));
});
