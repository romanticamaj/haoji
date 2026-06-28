import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockAnalyze = jest.fn();
jest.mock('../../lib/api', () => ({
  analyze: (...a: any[]) => mockAnalyze(...a),
  getModels: jest.fn().mockResolvedValue({ ok: true, models: ['gemma4:e4b-it-qat'], default: 'gemma4:e4b-it-qat' }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(false), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
}));
import AnalysisTab from '../AnalysisTab';
import { SavedSession } from '../../lib/store';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

const base: SavedSession = {
  id: 's', createdAt: 1, title: 't', unlocked: false, names: { SPEAKER_00: 'Gary' },
  transcript: { speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 1, speaker: 'SPEAKER_00', text: '嗨' }] },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAnalyze.mockResolvedValue({ notes: '## 會議摘要\n摘要內容\n\n## 討論重點\n- 機密重點', model: 'gemma4:e4b-it-qat' });
});

test('generating notes calls analyze with names and saves via onUpdate', async () => {
  const onUpdate = jest.fn();
  const { getByText } = await render(<AnalysisTab session={base} onUpdate={onUpdate} onUnlock={() => {}} />);
  fireEvent.press(getByText('生成會議記錄'));
  await waitFor(() => expect(mockAnalyze).toHaveBeenCalledWith('s', { model: undefined, names: { SPEAKER_00: 'Gary' } }));
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ notes: expect.stringContaining('會議摘要') }));
});

test('locked: shows preview and unlock CTA, hides copy action', async () => {
  const s = { ...base, notes: '## 會議摘要\n摘要內容\n\n## 討論重點\n- 機密重點', unlocked: false };
  const { getByText, queryByText } = await render(<AnalysisTab session={s} onUpdate={() => {}} onUnlock={() => {}} />);
  getByText(/摘要內容/);
  getByText('🔒 解鎖完整內容');
  expect(queryByText('複製')).toBeNull();
});

test('unlocked: shows full notes + 複製', async () => {
  const s = { ...base, notes: '## 會議摘要\n摘要內容\n\n## 討論重點\n- 機密重點', unlocked: true };
  const { getByText } = await render(<AnalysisTab session={s} onUpdate={() => {}} onUnlock={() => {}} />);
  getByText(/機密重點/);
  getByText('複製');
});

test('匯出 writes temp file and shares via file:// URI', async () => {
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(true);
  const s = { ...base, notes: '## 會議摘要\n摘要內容\n\n## 討論重點\n- 機密重點', unlocked: true };
  const { getByText } = await render(<AnalysisTab session={s} onUpdate={() => {}} onUnlock={() => {}} />);
  fireEvent.press(getByText('匯出'));
  await waitFor(() => expect(FileSystem.writeAsStringAsync).toHaveBeenCalled());
  expect(Sharing.shareAsync).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\//));
});

test('進階 model list: selecting a model passes it to analyze', async () => {
  // Use two models so pressing the non-default one produces a visible state change
  const { getModels } = require('../../lib/api');
  (getModels as jest.Mock).mockResolvedValueOnce({ ok: true, models: ['gemma4:e4b-it-qat', 'phi4:mini'], default: 'gemma4:e4b-it-qat' });
  const onUpdate = jest.fn();
  const { getByText, findByText } = await render(<AnalysisTab session={base} onUpdate={onUpdate} onUnlock={() => {}} />);
  fireEvent.press(getByText('進階'));
  await findByText(/phi4:mini/); // wait for models list to render
  fireEvent.press(getByText(/phi4:mini/)); // press the non-default model
  // Wait for the selection to visually change (first model loses ●)
  await waitFor(() => getByText(/○ gemma4:e4b-it-qat/));
  fireEvent.press(getByText('生成會議記錄'));
  await waitFor(() => expect(mockAnalyze).toHaveBeenCalledWith('s', { model: 'phi4:mini', names: { SPEAKER_00: 'Gary' } }));
});
