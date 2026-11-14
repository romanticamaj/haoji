import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';

const mockCreateSession = jest.fn();
const mockGetSession = jest.fn();
const mockGetStatus = jest.fn();
jest.mock('../../lib/api', () => ({
  createSession: (...a: any[]) => mockCreateSession(...a),
  uploadPart: jest.fn(async () => 1),
  transcribe: jest.fn(async () => {}),
  getSession: (...a: any[]) => mockGetSession(...a),
  getStatus: (...a: any[]) => mockGetStatus(...a),
}));
const mockNavigate = jest.fn();
// jobRunner keeps a process-wide registry of running jobs, so each test uses its own session id.
let mockSessionId = 's1';
jest.mock('@react-navigation/native', () => {
  const nav = { replace: jest.fn(), popToTop: jest.fn(), navigate: (...a: any[]) => mockNavigate(...a) };
  return { useNavigation: () => nav, useRoute: () => ({ params: { sessionId: mockSessionId } }) };
});
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore, SavedSession } from '../../lib/store';
import { NotPairedError } from '../../lib/server';
import ProcessingScreen from '../ProcessingScreen';

const status = require('../../../backend/tests/fixtures/contracts/status.json');
const green = { ...status, ok: true, checks: status.checks.map((c: any) => ({ ...c, ok: true })), queue: { active: 0, queued: 0 } };

const seed = (over: Partial<SavedSession> = {}): SavedSession => ({
  id: mockSessionId, createdAt: 1, title: 't', unlocked: false, names: {},
  parts: [{ uri: 'haoji/s1/part-0.wav', durationMs: 1000 }], ...over,
});

beforeEach(() => { jest.clearAllMocks(); mockGetStatus.mockResolvedValue(green); });

const renderWith = (s: SavedSession) =>
  render(<StoreProvider store={createMemoryStore([s])}><ProcessingScreen /></StoreProvider>);

test('shows the four stages with the current one announced', async () => {
  mockGetSession.mockResolvedValue({ status: 'running', pct: 0.4, message: '辨識中（含講者分離）…' });
  const { getByText, getByLabelText } = await renderWith(seed({
    backendId: 'b1',
    job: { stage: 'transcribing', uploaded: 1, pct: 0.4, message: '辨識中…', updatedAt: 1, serverStatus: 'running' },
  }));
  for (const label of ['上傳', '排隊', '辨識', '整理']) getByText(label);
  await waitFor(() => getByLabelText('整理進度：辨識，第 3 步，共 4 步'));
});

test('unpaired: the failure offers 連接主機 instead of 重試', async () => {
  mockSessionId = 's2';
  mockCreateSession.mockRejectedValue(new NotPairedError());
  mockGetStatus.mockRejectedValue(new NotPairedError());
  const { getByRole, queryByRole } = await renderWith(seed());
  await waitFor(() => getByRole('button', { name: '連接主機後就能生成逐字稿' }));
  expect(queryByRole('button', { name: '重試' })).toBeNull();
  await fireEvent.press(getByRole('button', { name: '連接主機後就能生成逐字稿' }));
  expect(mockNavigate).toHaveBeenCalledWith('Pair');
});

test('offline: 重試 is disabled and says the recording is safe', async () => {
  mockSessionId = 's3';
  mockCreateSession.mockRejectedValue(new Error('連不到'));
  mockGetStatus.mockRejectedValue(new TypeError('Network request failed'));
  const { getByRole, getByText } = await renderWith(seed());
  await waitFor(() => getByText('主機沒有回應，錄音還在手機上。'));
  expect(getByRole('button', { name: '重試' })).toBeDisabled();
});
