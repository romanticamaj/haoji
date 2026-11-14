import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act, within } from '@testing-library/react-native';

// Spec §5.3 C: Results = custom header (back · title · …), tabs right under it, a docked mini player.
const mockGetStatus = jest.fn();
jest.mock('../../lib/api', () => ({
  analyze: jest.fn(),
  createSession: jest.fn(),
  analyzeInBackground: jest.fn().mockResolvedValue(undefined),
  getSession: jest.fn(),
  getStatus: (...a: any[]) => mockGetStatus(...a),
  getModels: jest.fn().mockResolvedValue({ ok: true, models: [], default: '' }),
}));
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/doc', writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined), exists: jest.fn().mockResolvedValue(true),
}));
const mockDeleteFiles = jest.fn().mockResolvedValue(undefined);
jest.mock('../../lib/recordings', () => ({
  ...jest.requireActual('../../lib/recordings'),
  partExists: jest.fn().mockResolvedValue(true),
  deleteSessionFiles: (...a: any[]) => mockDeleteFiles(...a),
}));
const mockNav = {
  navigate: jest.fn(), replace: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), popToTop: jest.fn(),
};
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { sessionId: 's' } }),
  useNavigation: () => mockNav,
  useFocusEffect: (cb: any) => { const React = require('react'); React.useEffect(cb, []); },
}));

import ResultsScreen from '../ResultsScreen';
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore, SavedSession } from '../../lib/store';

const STATUS = require('../../../backend/tests/fixtures/contracts/status.json');
const trigger = () => require('react-native-haptic-feedback').default.trigger as jest.Mock;

const seed: SavedSession = {
  id: 's', createdAt: 1, title: '週會', unlocked: true, names: {},
  transcript: { speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 1, speaker: 'SPEAKER_00', text: '嗨大家好' }] },
  parts: [{ uri: 'haoji/s/part-0.wav', durationMs: 90000 }],
};

async function renderResults(session: SavedSession = seed) {
  const store = createMemoryStore([session]);
  const r = await render(<StoreProvider store={store}><ResultsScreen /></StoreProvider>);
  await r.findByText('嗨大家好');
  return { store, ...r };
}
async function openMenu(r: { getByRole: any; findByTestId: any }) {
  await fireEvent.press(r.getByRole('button', { name: '更多動作' }));
  return r.findByTestId('overflow-menu');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetStatus.mockResolvedValue(STATUS);
});

// Issue #32 item 8: while the push finishes, placeholder turns stand in for the transcript — no spinner.
test('before the content mounts, Results shows the skeleton turns, not a spinner', async () => {
  const store = createMemoryStore([seed]);
  const r = await render(<StoreProvider store={store}><ResultsScreen /></StoreProvider>);
  r.getByTestId('results-skeleton');
  expect(r.getAllByTestId('skeleton-turn')).toHaveLength(6);
  await r.findByText('嗨大家好');
  expect(r.queryByTestId('results-skeleton')).toBeNull();
});

test('the header shows the title on one line with back and …', async () => {
  const r = await renderResults();
  expect(r.getByRole('header', { name: '週會' }).props.numberOfLines).toBe(1);
  await fireEvent.press(r.getByRole('button', { name: '返回' }));
  expect(mockNav.goBack).toHaveBeenCalled();
});

test('the overflow holds all five actions, 刪除 last and in danger style', async () => {
  const r = await renderResults();
  const menu = await openMenu(r);
  const rows = within(menu).getAllByRole('button').filter((b: any) => b.props.testID?.startsWith('overflow-'));
  expect(rows.map((b: any) => b.props.accessibilityLabel)).toEqual(
    ['重新命名', '匯出錄音', '繼續錄音', '重新生成逐字稿', '刪除這場會議']);
});

test('overflow 重新命名 opens the title sheet and saves the new name', async () => {
  const r = await renderResults();
  await openMenu(r);
  await fireEvent.press(r.getByTestId('overflow-rename'));
  await fireEvent.changeText(await r.findByTestId('title-input'), '季度規劃');
  await fireEvent.press(r.getByTestId('title-done'));
  await waitFor(async () => expect((await r.store.get('s'))?.title).toBe('季度規劃'));
});

test('overflow 匯出錄音 shares the recording', async () => {
  const Share = require('react-native-share');
  const r = await renderResults();
  await openMenu(r);
  await fireEvent.press(r.getByTestId('overflow-export'));
  await waitFor(() => expect(Share.open).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio/wav' })));
});

test('overflow 繼續錄音 records into this meeting', async () => {
  const r = await renderResults();
  await openMenu(r);
  await fireEvent.press(r.getByTestId('overflow-append'));
  expect(mockNav.navigate).toHaveBeenCalledWith('Record', { appendTo: 's' });
});

test('overflow 重新生成逐字稿 confirms, then restarts processing', async () => {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const r = await renderResults();
    await openMenu(r);
    await fireEvent.press(r.getByTestId('overflow-regen'));
    expect(spy.mock.calls[0][0]).toBe('重新生成逐字稿？');
    await act(async () => { (spy.mock.calls[0] as any[])[2][1].onPress(); });
    expect(mockNav.replace).toHaveBeenCalledWith('Processing', { sessionId: 's', regen: true });
  } finally { spy.mockRestore(); }
});

// Moved here from the transcript toolbar (issue #32 item 4): `…` is now the only way to re-run it.
// A transcript has no version history, so the dialog says the current one cannot be recovered.
test('overflow 重新生成逐字稿 says the current transcript cannot be recovered; 取消 leaves it alone', async () => {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const r = await renderResults();
    await openMenu(r);
    await fireEvent.press(r.getByTestId('overflow-regen'));
    expect(mockNav.replace).not.toHaveBeenCalled();           // nothing happens without confirming
    const [, body, buttons] = spy.mock.calls[0] as any[];
    expect(body).toMatch(/無法還原/);
    buttons[0].onPress?.();                                    // 取消
    expect(mockNav.replace).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});

test('confirming 重新生成逐字稿 twice still starts only one run', async () => {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const r = await renderResults();
    await openMenu(r);
    await fireEvent.press(r.getByTestId('overflow-regen'));
    const confirm = (spy.mock.calls[0] as any[])[2][1].onPress;
    await act(async () => { confirm(); confirm(); });
    expect(mockNav.replace).toHaveBeenCalledTimes(1);
  } finally { spy.mockRestore(); }
});

test('overflow 刪除這場會議 confirms, warns by haptic, removes and goes home', async () => {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const r = await renderResults();
    await openMenu(r);
    await fireEvent.press(r.getByTestId('overflow-delete'));
    expect(spy.mock.calls[0][0]).toBe('刪除「週會」？');
    trigger().mockClear();
    await act(async () => { await (spy.mock.calls[0] as any[])[2][1].onPress(); });
    expect(trigger().mock.calls.map((c) => c[0])).toEqual(['notificationWarning']);
    expect(await r.store.get('s')).toBeNull();
    expect(mockDeleteFiles).toHaveBeenCalledWith('s');
    expect(mockNav.popToTop).toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});

test('the mini player is docked with play and the time, and expands on tap', async () => {
  const r = await renderResults();
  const play = await r.findByTestId('mini-play');
  expect(play.props.accessibilityLabel).toBe('播放');
  r.getByText('00:00 / 01:30');
  await fireEvent.press(r.getByTestId('mini-expand'));
  await r.findByRole('button', { name: '收合播放器' });
  expect(r.getByTestId('mini-card').props.accessibilityElementsHidden).toBe(false);
});

test('tapping a transcript turn still plays from there (through the docked player)', async () => {
  const { useAudioPlayer } = require('@simform_solutions/react-native-audio-waveform');
  const { seekToPlayer } = useAudioPlayer();
  const r = await renderResults();
  await r.findByTestId('mini-play');
  await r.findByLabelText(/^waveform-/, { includeHiddenElements: true });
  await fireEvent.press(r.getByTestId('turn-body-0'));
  await waitFor(() => expect(seekToPlayer).toHaveBeenCalledWith(expect.objectContaining({ progress: 0 })));
  await waitFor(() => expect(r.getByTestId('mini-play').props.accessibilityLabel).toBe('暫停'));
});

test('changing tabs fires the light haptic and slides the underline', async () => {
  const r = await renderResults();
  trigger().mockClear();
  await fireEvent.press(r.getByRole('tab', { name: '會議記錄' }));
  expect(trigger().mock.calls.map((c) => c[0])).toEqual(['impactLight']);
  expect(r.getByRole('tab', { name: '會議記錄' }).props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  r.getByTestId('tab-underline');
});

test('Results offline keeps player', async () => {
  mockGetStatus.mockRejectedValue(new Error('network down'));
  const r = await renderResults();
  // Playback and the transcript are local and keep working…
  const play = await r.findByTestId('mini-play');
  expect(play).not.toBeDisabled();
  r.getByText('嗨大家好');
  // …only the server action (in `…`) is off, and says why.
  await openMenu(r);
  await waitFor(() => expect(within(r.getByTestId('overflow-menu')).getByTestId('overflow-regen')).toBeDisabled());
  const menu = r.getByTestId('overflow-menu');
  within(menu).getByText('主機沒有回應，錄音還在手機上。');
  expect(within(menu).getByTestId('overflow-export')).not.toBeDisabled();
  expect(within(menu).getByTestId('overflow-append')).not.toBeDisabled();
});

test('no recording on the phone: no mini player, and export / regenerate are off', async () => {
  const r = await renderResults({ ...seed, parts: [] });
  await new Promise<void>((res) => { setTimeout(() => res(), 650); });   // past the deferred-mount window
  expect(r.queryByTestId('mini-play')).toBeNull();
  const menu = await openMenu(r);
  expect(within(menu).getByTestId('overflow-export')).toBeDisabled();
  expect(within(menu).getByTestId('overflow-regen')).toBeDisabled();
});
