import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
const mockPick = jest.fn();
jest.mock('@react-native-documents/picker', () => ({
  pick: (...a: any[]) => mockPick(...a), keepLocalCopy: jest.fn(), types: { audio: 'a', video: 'v' },
  isErrorWithCode: () => false, errorCodes: { OPERATION_CANCELED: 'x' },
}));
jest.mock('react-native-image-picker', () => ({ launchImageLibrary: jest.fn() }));
// Keep a seeded 'processing' job as it is — resuming it for real would hit the (absent) server.
jest.mock('../../lib/jobRunner', () => ({ resumeAllJobs: jest.fn(), onJobChange: () => () => {} }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const React = require('react');
  const nav = { navigate: (...a: any[]) => mockNavigate(...a), addListener: () => () => {} };
  return {
    useNavigation: () => nav,
    useFocusEffect: (cb: () => any) => React.useEffect(cb, [cb]),
  };
});

import HomeScreen, { SEARCH_DEBOUNCE_MS } from '../HomeScreen';
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore, SavedSession } from '../../lib/store';
import { colors } from '../../lib/theme';
import type { Job } from '../../lib/job';

const mk = (id: string, t: number, title: string, over: Partial<SavedSession> = {}): SavedSession =>
  ({ id, createdAt: t, title, names: {}, unlocked: false, parts: [], ...over });
const tx = (texts: string[]) => ({
  speakers: ['SPEAKER_00'],
  segments: texts.map((text, i) => ({ start: i, end: i + 1, speaker: 'SPEAKER_00', text })),
});

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as any;
});

const renderHome = async (seed: SavedSession[]) => {
  const utils = await render(
    <SafeAreaProvider>
      <StoreProvider store={createMemoryStore(seed)}><HomeScreen /></StoreProvider>
    </SafeAreaProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return utils;
};

describe('search', () => {
  const seed = [
    mk('a', 2, '週會 Sprint'),
    mk('b', 1, '客戶訪談', { transcript: tx(['開場', '我們來談一下預算的問題']) }),
  ];

  test(`is debounced by ${150} ms`, async () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(150);
    // Real timers: the store + status polling don't mix well with fake ones. The point is that a
    // keystroke never searches synchronously, and the result lands about 150 ms later.
    const { getByTestId, getByPlaceholderText, queryByText, findByText, getByText } = await renderHome(seed);
    await waitFor(() => getByText('客戶訪談'));
    await act(async () => { fireEvent.press(getByTestId('home-search-toggle')); });
    const t0 = Date.now();
    fireEvent.changeText(getByPlaceholderText('搜尋會議'), 'zzz');
    expect(queryByText('找不到「zzz」')).toBeNull();
    await findByText('找不到「zzz」');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(SEARCH_DEBOUNCE_MS - 20);
  });

  test('finds words inside the transcript and highlights the match in primarySoft', async () => {
    const { getByTestId, getByPlaceholderText, getAllByTestId, queryByText, getByText } = await renderHome(seed);
    await waitFor(() => getByText('客戶訪談'));
    await act(async () => { fireEvent.press(getByTestId('home-search-toggle')); });
    fireEvent.changeText(getByPlaceholderText('搜尋會議'), '預算');
    await waitFor(() => getAllByTestId('search-hit-mark'));
    expect(queryByText('週會 Sprint')).toBeNull();
    const mark = getAllByTestId('search-hit-mark')[0];
    expect(mark).toHaveTextContent('預算');
    expect(StyleSheet.flatten(mark.props.style).backgroundColor).toBe(colors.primarySoft);
  });

  test('tapping a transcript hit opens Results at that turn', async () => {
    const { getByTestId, getByPlaceholderText, getByText, getAllByTestId } = await renderHome(seed);
    await waitFor(() => getByText('客戶訪談'));
    await act(async () => { fireEvent.press(getByTestId('home-search-toggle')); });
    fireEvent.changeText(getByPlaceholderText('搜尋會議'), '預算');
    await waitFor(() => getAllByTestId('search-hit'));
    await act(async () => { fireEvent.press(getAllByTestId('search-hit')[0]); });
    expect(mockNavigate).toHaveBeenCalledWith('Results', expect.objectContaining({ sessionId: 'b', focusSegment: 1 }));
  });

  test('a full-width query finds a half-width title', async () => {
    const { getByTestId, getByPlaceholderText, getByText, getAllByTestId } = await renderHome(seed);
    await waitFor(() => getByText('客戶訪談'));
    await act(async () => { fireEvent.press(getByTestId('home-search-toggle')); });
    fireEvent.changeText(getByPlaceholderText('搜尋會議'), 'ＳＰＲＩＮＴ');
    await waitFor(() => expect(getAllByTestId('search-hit-mark')[0]).toHaveTextContent('Sprint'));
  });

  test('closing search brings the full list back', async () => {
    const { getByTestId, getByPlaceholderText, getByText, queryByPlaceholderText } = await renderHome(seed);
    await waitFor(() => getByText('客戶訪談'));
    await act(async () => { fireEvent.press(getByTestId('home-search-toggle')); });
    fireEvent.changeText(getByPlaceholderText('搜尋會議'), 'zzz');
    await waitFor(() => getByText('找不到「zzz」'));
    await act(async () => { fireEvent.press(getByTestId('home-search-toggle')); });
    expect(queryByPlaceholderText('搜尋會議')).toBeNull();
    getByText('週會 Sprint');
  });
});

describe('meeting card meta line', () => {
  const running: Job = { stage: 'transcribing', pct: 0.3 } as any;
  test.each([
    ['transcribed', { transcript: tx(['嗨']) }, '已有逐字稿'],
    ['processing', { job: running }, '處理中'],
    ['nothing yet', {}, '還沒生成'],
  ])('%s shows its status inline', async (_n, over, word) => {
    const { getByText, queryByText } = await renderHome([mk('a', Date.now(), '會議A', over as any)]);
    await waitFor(() => getByText('會議A'));
    getByText(new RegExp(` · ${word}$`));
    // The old separate status rows are gone.
    expect(queryByText('還沒有逐字稿')).toBeNull();
    expect(queryByText('還沒有會議記錄')).toBeNull();
    expect(queryByText('逐字稿')).toBeNull();
  });
});

describe('bottom bar', () => {
  test('is 匯入, 記下來 and 設定', async () => {
    const { getByLabelText, queryByLabelText } = await renderHome([]);
    await waitFor(() => getByLabelText('記下來：開始錄音'));
    getByLabelText('匯入音檔或影片');
    getByLabelText('設定與資料');
    expect(queryByLabelText('從相簿選影片')).toBeNull();
  });

  test('設定 opens Settings', async () => {
    const { getByLabelText } = await renderHome([]);
    await act(async () => { fireEvent.press(getByLabelText('設定與資料')); });
    expect(mockNavigate).toHaveBeenCalledWith('Settings');
  });

  test('匯入 opens a sheet offering 音檔 and 影片; 音檔 runs the audio import', async () => {
    mockPick.mockRejectedValue({ code: 'x' }); // user cancels the picker
    const { getByLabelText, getByText, queryByText } = await renderHome([]);
    await act(async () => { fireEvent.press(getByLabelText('匯入音檔或影片')); });
    getByText('音檔');
    getByText('影片');
    await act(async () => { fireEvent.press(getByLabelText('匯入音檔')); });
    await waitFor(() => expect(mockPick).toHaveBeenCalled());
    expect(queryByText('影片')).toBeNull(); // the sheet closed
  });
});
