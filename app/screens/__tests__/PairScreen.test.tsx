import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
let mockParams: any = undefined;
jest.mock('@react-navigation/native', () => {
  const nav = {
    goBack: (...a: any[]) => mockGoBack(...a),
    navigate: (...a: any[]) => mockNavigate(...a),
    canGoBack: () => true,
  };
  return { useNavigation: () => nav, useRoute: () => ({ params: mockParams }) };
});

import PairScreen from '../PairScreen';
import * as server from '../../lib/server';

const status = require('../../../backend/tests/fixtures/contracts/status.json');
const answer = (code: number, body: any) =>
  jest.fn().mockResolvedValue({ ok: code < 300, status: code, json: async () => body });

beforeEach(async () => { jest.clearAllMocks(); mockParams = undefined; await server.forgetServer(); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('a pair link prefills the address and the token', async () => {
  mockParams = { url: 'http://100.64.0.5:7780', token: 'pTk' };
  const { getByLabelText } = await render(<PairScreen />);
  expect(getByLabelText('主機網址').props.value).toBe('http://100.64.0.5:7780');
  expect(getByLabelText('配對金鑰（選填）').props.value).toBe('pTk');
});

test('shows how to get the link', async () => {
  const { getByText } = await render(<PairScreen />);
  getByText('在主機的管理頁「配對手機」，用相機掃 QR code 就會自動填好。');
});

test('connect is disabled until there is an address', async () => {
  const { getByRole } = await render(<PairScreen />);
  expect(getByRole('button', { name: '連接' })).toBeDisabled();
});

test('success saves the server, says 已連上, then goes back', async () => {
  jest.useFakeTimers();
  mockParams = { url: 'http://100.64.0.5:7780', token: 'pTk' };
  global.fetch = answer(200, status) as any;
  const { getByRole, getByText } = await render(<PairScreen />);
  await fireEvent.press(getByRole('button', { name: '連接' }));
  await waitFor(() => getByText('已連上 100.64.0.5:7780'));
  expect(await server.loadServer()).toMatchObject({ url: 'http://100.64.0.5:7780', token: 'pTk', name: '100.64.0.5:7780' });
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://100.64.0.5:7780/api/status');
  expect(mockGoBack).not.toHaveBeenCalled();
  await act(async () => { await jest.advanceTimersByTimeAsync(1500); });
  expect(mockGoBack).toHaveBeenCalled();
});

test('a typed address is normalised before it is saved', async () => {
  global.fetch = answer(200, status) as any;
  const { getByRole, getByLabelText, getByText } = await render(<PairScreen />);
  await fireEvent.changeText(getByLabelText('主機網址'), ' 192.168.1.20:7780/ ');
  await fireEvent.press(getByRole('button', { name: '連接' }));
  await waitFor(() => getByText('已連上 192.168.1.20:7780'));
  expect((await server.loadServer())?.url).toBe('http://192.168.1.20:7780');
  expect((await server.loadServer())?.token).toBeUndefined();
});

test('failure shows the reason and saves nothing', async () => {
  global.fetch = answer(200, { hello: 'world' }) as any;
  mockParams = { url: 'http://box:8080' };
  const { getByRole, getByText } = await render(<PairScreen />);
  await fireEvent.press(getByRole('button', { name: '連接' }));
  await waitFor(() => getByText('這個網址不是好記主機。'));
  expect(await server.loadServer()).toBeNull();
  expect(mockGoBack).not.toHaveBeenCalled();
});

test('unreachable shows the network hint', async () => {
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as any;
  mockParams = { url: 'http://box:7780' };
  const { getByRole, getByText } = await render(<PairScreen />);
  await fireEvent.press(getByRole('button', { name: '連接' }));
  await waitFor(() => getByText('連不到這個網址，確認主機有開、手機和主機在同一個網路或 Tailscale 上。'));
});

test('a bad pair link explains itself and prefills nothing', async () => {
  mockParams = { error: '這不是好記主機的配對連結。' };
  const { getByText, getByLabelText } = await render(<PairScreen />);
  getByText('這不是好記主機的配對連結。');
  expect(getByLabelText('主機網址').props.value).toBe('');
});
