import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

const mockProbe = jest.fn();
jest.mock('../../lib/audioMerge', () => ({
  available: true,
  probe: (...a: any[]) => mockProbe(...a),
  concatWav: jest.fn(),
  concatToM4A: jest.fn(),
}));
const mockMoveToPart = jest.fn();
const mockMerge = jest.fn();
jest.mock('../../lib/recordings', () => ({
  fsPath: (p: string) => p.replace(/^file:\/\//, ''),
  moveToPart: (...a: any[]) => mockMoveToPart(...a),
  mergeSessionParts: (...a: any[]) => mockMerge(...a),
}));
jest.mock('../../lib/audioExtract', () => ({ available: false, extractAudio: jest.fn() }));

const mockReplace = jest.fn();
const mockGoBack = jest.fn();
const routeFiles = [
  { uri: 'file:///c/one.m4a', name: 'one.m4a' },
  { uri: 'file:///c/two.m4a', name: 'two.m4a' },
  { uri: 'file:///c/doc.pdf', name: 'doc.pdf' },
];
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ replace: mockReplace, goBack: mockGoBack, navigate: jest.fn() }),
  useRoute: () => ({ params: { files: routeFiles } }),
}));

const mockStore = { upsert: jest.fn().mockResolvedValue(undefined), get: jest.fn(), list: jest.fn(), remove: jest.fn() };
jest.mock('../../lib/store-context', () => ({ useStore: () => mockStore }));

import ImportConfirmScreen from '../ImportConfirmScreen';

beforeEach(() => {
  jest.clearAllMocks();
  mockProbe.mockResolvedValue([
    { path: '/c/one.m4a', ok: true, durationMs: 60000 },
    { path: '/c/two.m4a', ok: true, durationMs: 30000 },
    { path: '/c/doc.pdf', ok: false, durationMs: 0, reason: '沒有音訊' },
  ]);
  mockMoveToPart.mockImplementation((id: string, i: number) => Promise.resolve(`haoji/${id}/part-${i}.m4a`));
  mockMerge.mockResolvedValue(null);
});

test('shows what each file actually is, and refuses to tick an unusable one', async () => {
  const { getByText, findByText } = await render(<ImportConfirmScreen />);
  await findByText('one.m4a');
  getByText('沒有音訊');                       // decoded, not guessed from the extension
  await act(async () => { fireEvent.press(getByText('doc.pdf')); });
  getByText('已選 2/3 個 · 共 01:30');          // still 2 — the bad file cannot be selected
});

test('deselecting a file removes it from the count and the import', async () => {
  const { getByText, findByText } = await render(<ImportConfirmScreen />);
  await findByText('one.m4a');
  await act(async () => { fireEvent.press(getByText('two.m4a')); });
  getByText('已選 1/3 個 · 共 01:00');
});

test('reordering changes the ORDER the files are written in — the merge order', async () => {
  const { getByTestId, findByText, getByText } = await render(<ImportConfirmScreen />);
  await findByText('one.m4a');

  await act(async () => { fireEvent.press(getByTestId('down-one.m4a')); });   // two, one, doc
  await act(async () => { fireEvent.press(getByText('合併成一段並繼續')); });

  await waitFor(() => expect(mockMoveToPart).toHaveBeenCalledTimes(2));
  // part-0 is now the file the user moved up, not the one the picker happened to return first
  expect(mockMoveToPart.mock.calls[0][2]).toBe('file:///c/two.m4a');
  expect(mockMoveToPart.mock.calls[1][2]).toBe('file:///c/one.m4a');
  expect(mockMerge).toHaveBeenCalled();
});

test('保持分開 imports the selected files without joining them', async () => {
  const { getByText, findByText } = await render(<ImportConfirmScreen />);
  await findByText('one.m4a');
  await act(async () => { fireEvent.press(getByText('保持分開')); });

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Review', { sessionId: expect.stringMatching(/^local-/) }));
  expect(mockMerge).not.toHaveBeenCalled();
  expect(mockStore.upsert).toHaveBeenCalledWith(expect.objectContaining({
    parts: [
      { uri: expect.stringMatching(/part-0\.m4a$/), durationMs: 60000 },
      { uri: expect.stringMatching(/part-1\.m4a$/), durationMs: 30000 },
    ],
  }));
});

test('the unusable file is never imported, whichever action is taken', async () => {
  const { getByText, findByText } = await render(<ImportConfirmScreen />);
  await findByText('one.m4a');
  await act(async () => { fireEvent.press(getByText('保持分開')); });
  await waitFor(() => expect(mockMoveToPart).toHaveBeenCalledTimes(2));
  for (const call of mockMoveToPart.mock.calls) expect(call[2]).not.toContain('doc.pdf');
});
