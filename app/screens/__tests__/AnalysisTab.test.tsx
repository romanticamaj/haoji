import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockAnalyze = jest.fn();
jest.mock('../../lib/api', () => ({
  analyze: (...a: any[]) => mockAnalyze(...a),
  getModels: jest.fn().mockResolvedValue({ ok: true, models: ['gemma4:e4b-it-qat'], default: 'gemma4:e4b-it-qat' }),
}));
jest.mock('@react-native-clipboard/clipboard', () => ({ setString: jest.fn() }));
jest.mock('react-native-share', () => ({ open: jest.fn().mockResolvedValue({}) }));
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/doc',
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));
import AnalysisTab from '../AnalysisTab';
import { SavedSession } from '../../lib/store';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import Clipboard from '@react-native-clipboard/clipboard';

const base: SavedSession = {
  id: 's', createdAt: 1, title: 't', unlocked: false, names: { SPEAKER_00: 'Gary' },
  transcript: { speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 1, speaker: 'SPEAKER_00', text: '嗨' }] },
  parts: [],
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

test('analyze targets the backend id when present (not the local id)', async () => {
  const onUpdate = jest.fn();
  const s = { ...base, id: 'local-123', backendId: 'backend-xyz' };
  const { getByText } = await render(<AnalysisTab session={s} onUpdate={onUpdate} onUnlock={() => {}} />);
  fireEvent.press(getByText('生成會議記錄'));
  await waitFor(() => expect(mockAnalyze).toHaveBeenCalledWith('backend-xyz', { model: undefined, names: { SPEAKER_00: 'Gary' } }));
});

test('no transcript: blocks generation, shows gate hint + 前往逐字稿', async () => {
  const onGo = jest.fn();
  const s = { ...base, transcript: { speakers: [], segments: [] } };
  const { getByText, queryByText } = await render(
    <AnalysisTab session={s} onUpdate={() => {}} onUnlock={() => {}} onGoToTranscript={onGo} />);
  expect(queryByText('生成會議記錄')).toBeNull();
  getByText(/還沒有逐字稿/);
  fireEvent.press(getByText('前往逐字稿'));
  expect(onGo).toHaveBeenCalled();
});

test('locked: shows preview and unlock CTA, hides copy action', async () => {
  const s = { ...base, notes: '## 會議摘要\n摘要內容\n\n## 討論重點\n- 機密重點', unlocked: false };
  const { getByText, queryByText } = await render(<AnalysisTab session={s} onUpdate={() => {}} onUnlock={() => {}} />);
  getByText(/摘要內容/);
  getByText('解鎖完整會議記錄');
  expect(queryByText('複製 Markdown')).toBeNull();
  expect(queryByText('複製純文字')).toBeNull();
});

test('unlocked: 複製 Markdown copies raw markdown to clipboard', async () => {
  const s = { ...base, notes: '## 會議摘要\n摘要內容\n\n## 討論重點\n- 機密重點', unlocked: true };
  const { getByText } = await render(<AnalysisTab session={s} onUpdate={() => {}} onUnlock={() => {}} />);
  getByText(/機密重點/);
  fireEvent.press(getByText('複製 Markdown'));
  expect((Clipboard.setString as jest.Mock)).toHaveBeenCalledWith(expect.stringContaining('## 會議摘要'));
});

test('unlocked: 複製純文字 copies markdown-stripped plain text', async () => {
  const s = { ...base, notes: '## 會議摘要\n摘要內容\n\n## 討論重點\n- 機密重點', unlocked: true };
  const { getByText } = await render(<AnalysisTab session={s} onUpdate={() => {}} onUnlock={() => {}} />);
  fireEvent.press(getByText('複製純文字'));
  const arg = (Clipboard.setString as jest.Mock).mock.calls[0][0] as string;
  expect(arg).toContain('會議摘要');
  expect(arg).not.toContain('##');
  expect(arg).toContain('• 機密重點');
});

test('匯出 writes temp .md and shares via file:// URI (no availability gate)', async () => {
  const s = { ...base, notes: '## 會議摘要\n摘要內容\n\n## 討論重點\n- 機密重點', unlocked: true };
  const { getByText } = await render(<AnalysisTab session={s} onUpdate={() => {}} onUnlock={() => {}} />);
  fireEvent.press(getByText('匯出'));
  await waitFor(() => expect(RNFS.writeFile as jest.Mock).toHaveBeenCalled());
  expect(Share.open as jest.Mock).toHaveBeenCalledWith(
    expect.objectContaining({ url: expect.stringMatching(/^file:\/\/.*會議記錄\.md$/) }),
  );
});

test('進階 model list: selecting a model passes it to analyze', async () => {
  const { getModels } = require('../../lib/api');
  (getModels as jest.Mock).mockResolvedValueOnce({ ok: true, models: ['gemma4:e4b-it-qat', 'phi4:mini'], default: 'gemma4:e4b-it-qat' });
  const onUpdate = jest.fn();
  const { getByText, findByText } = await render(<AnalysisTab session={base} onUpdate={onUpdate} onUnlock={() => {}} />);
  fireEvent.press(getByText('進階'));
  await findByText(/phi4:mini/);
  fireEvent.press(getByText(/phi4:mini/));
  await waitFor(() => getByText(/○ gemma4:e4b-it-qat/));
  fireEvent.press(getByText('生成會議記錄'));
  await waitFor(() => expect(mockAnalyze).toHaveBeenCalledWith('s', { model: 'phi4:mini', names: { SPEAKER_00: 'Gary' } }));
});
