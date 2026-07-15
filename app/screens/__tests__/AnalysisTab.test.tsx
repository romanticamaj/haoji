import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

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

test('generation promotes the AI H1 to the meeting title when the title is a timestamp default', async () => {
  const onUpdate = jest.fn();
  mockAnalyze.mockResolvedValueOnce({ notes: '# 會議記錄：AI 導入探討會\n\n## 會議摘要\n內容', model: 'm' });
  const s = { ...base, title: '7/15/2026, 12:07:52 AM' };
  const { getByText } = await render(<AnalysisTab session={s} onUpdate={onUpdate} onUnlock={() => {}} />);
  fireEvent.press(getByText('生成會議記錄'));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ title: 'AI 導入探討會' })));
});

test('generation keeps a user-typed title (does not overwrite with the AI title)', async () => {
  const onUpdate = jest.fn();
  mockAnalyze.mockResolvedValueOnce({ notes: '# 會議記錄：AI 導入探討會\n\n## 會議摘要\n內容', model: 'm' });
  const s = { ...base, title: '客戶月會' };
  const { getByText } = await render(<AnalysisTab session={s} onUpdate={onUpdate} onUnlock={() => {}} />);
  fireEvent.press(getByText('生成會議記錄'));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ title: '客戶月會' })));
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

test('unlocked: 複製 shows a ✓ 已複製 confirmation (was silent before)', async () => {
  const s = { ...base, notes: '## 會議摘要\n摘要內容', unlocked: true };
  const { getByText, queryByText } = await render(<AnalysisTab session={s} onUpdate={() => {}} onUnlock={() => {}} />);
  expect(queryByText('已複製')).toBeNull();
  await act(async () => { fireEvent.press(getByText('複製 Markdown')); });
  getByText('已複製');
});

test('editing the notes saves via onUpdate and archives the prior version', async () => {
  const onUpdate = jest.fn();
  const s = { ...base, notes: '## 會議摘要\n舊內容', unlocked: true };
  const { getByText, getByTestId } = await render(<AnalysisTab session={s} onUpdate={onUpdate} onUnlock={() => {}} />);
  await act(async () => { fireEvent.press(getByText('編輯')); });
  await act(async () => { fireEvent.changeText(getByTestId('notes-editor-input'), '## 會議摘要\n新內容'); });
  await act(async () => { fireEvent.press(getByTestId('notes-save')); });
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
    notes: '## 會議摘要\n新內容',
    notesHistory: [expect.objectContaining({ notes: '## 會議摘要\n舊內容' })],
  }));
});

test('leaked LaTeX arrows ($lrightarrow$) are cleaned before copy', async () => {
  const s = { ...base, notes: '## 摘要\n篩選$lrightarrow$撰寫', unlocked: true };
  const { getByText } = await render(<AnalysisTab session={s} onUpdate={() => {}} onUnlock={() => {}} />);
  fireEvent.press(getByText('複製 Markdown'));
  const arg = (Clipboard.setString as jest.Mock).mock.calls[0][0] as string;
  expect(arg).toContain('→');
  expect(arg).not.toContain('lrightarrow');
});

test('修正關鍵字 from the notes page replaces across notes + transcript via onUpdate', async () => {
  const onUpdate = jest.fn();
  const s = {
    ...base, unlocked: true, notes: '## 摘要\n決定採用 Claude',
    transcript: { speakers: ['A'], segments: [{ start: 0, end: 1, speaker: 'A', text: '用 Claude' }] },
  };
  const { getByText, getByTestId } = await render(<AnalysisTab session={s} onUpdate={onUpdate} onUnlock={() => {}} />);
  await act(async () => { fireEvent.press(getByText('修正關鍵字')); });
  await act(async () => { fireEvent.changeText(getByTestId('kw-from-0'), 'Claude'); });
  await act(async () => { fireEvent.changeText(getByTestId('kw-to-0'), 'cloud'); });
  await act(async () => { fireEvent.press(getByTestId('kw-apply')); });
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
    notes: '## 摘要\n決定採用 cloud',
    transcript: expect.objectContaining({ segments: [expect.objectContaining({ text: '用 cloud' })] }),
  }));
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
