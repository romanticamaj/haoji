import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockAnalyze = jest.fn();
jest.mock('../../lib/api', () => ({
  analyze: (...a: any[]) => mockAnalyze(...a),
  getModels: jest.fn().mockResolvedValue({ ok: true, models: ['gemma4:e4b-it-qat'], default: 'gemma4:e4b-it-qat' }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(false), shareAsync: jest.fn() }));
import AnalysisTab from '../AnalysisTab';
import { SavedSession } from '../../lib/store';

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

test('locked: shows preview, hides the locked detail behind unlock', async () => {
  const s = { ...base, notes: '## 會議摘要\n摘要內容\n\n## 討論重點\n- 機密重點', unlocked: false };
  const { getByText, queryByText } = await render(<AnalysisTab session={s} onUpdate={() => {}} onUnlock={() => {}} />);
  getByText(/摘要內容/);
  expect(queryByText(/機密重點/)).toBeNull();
  getByText('🔒 解鎖完整內容');
});

test('unlocked: shows full notes + 複製', async () => {
  const s = { ...base, notes: '## 會議摘要\n摘要內容\n\n## 討論重點\n- 機密重點', unlocked: true };
  const { getByText } = await render(<AnalysisTab session={s} onUpdate={() => {}} onUnlock={() => {}} />);
  getByText(/機密重點/);
  getByText('複製');
});
