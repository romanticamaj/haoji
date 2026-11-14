import React from 'react';
import { Alert, Platform } from 'react-native';
import { render, act, waitFor } from '@testing-library/react-native';
import { captureBack } from '../../test-utils/backHandler';

// --- Record ---------------------------------------------------------------------------------------
const mockRecApi = {
  state: 'idle', durationMs: 0, meteringLevel: 0,
  parts: [] as any[], wasInterrupted: false, error: null as string | null,
  start: jest.fn(), pause: jest.fn(), resume: jest.fn(), clearError: jest.fn(),
  stop: jest.fn().mockResolvedValue([{ uri: 'haoji/x/part-0.wav', durationMs: 1000 }]),
};
jest.mock('../../hooks/useRecorder', () => ({ useRecorder: () => mockRecApi }));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(), keepLocalCopy: jest.fn(), types: { audio: 'a', video: 'v' },
  isErrorWithCode: () => false, errorCodes: { OPERATION_CANCELED: 'x' },
}));
jest.mock('../../lib/api', () => ({
  getStatus: jest.fn().mockRejectedValue(new Error('offline')),
}));
jest.mock('../../lib/jobRunner', () => ({
  ensureJob: jest.fn(), restartJob: jest.fn(), onJobChange: () => () => {},
}));
const mockNav = { replace: jest.fn(), goBack: jest.fn(), navigate: jest.fn(), popToTop: jest.fn(), isFocused: jest.fn(() => true), addListener: () => () => {} };
const mockRoute: { params: any } = { params: undefined };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => mockRoute,
}));
const mockStore = {
  list: jest.fn().mockResolvedValue([]),
  get: jest.fn().mockResolvedValue({ id: 's1', createdAt: 0, title: 't', names: {}, unlocked: false, parts: [] }),
  upsert: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../lib/store-context', () => ({ useStore: () => mockStore }));

import RecordScreen from '../RecordScreen';
import ProcessingScreen from '../ProcessingScreen';

beforeEach(() => {
  jest.clearAllMocks();
  mockNav.isFocused.mockReturnValue(true);
  mockRecApi.state = 'idle';
  jest.replaceProperty(Platform, 'OS', 'android');
});
afterEach(() => jest.restoreAllMocks());

describe('Record', () => {
  test('back while idle is left to navigation (no question asked)', async () => {
    const back = captureBack();
    const alert = jest.spyOn(Alert, 'alert');
    await render(<RecordScreen />);
    expect(back.press()).toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });

  test.each(['recording', 'paused'])('back while %s asks 「要結束這段錄音嗎？」 and 繼續錄音 keeps going', async (state) => {
    mockRecApi.state = state;
    const back = captureBack();
    const alert = jest.spyOn(Alert, 'alert');
    await render(<RecordScreen />);
    expect(back.press()).toBe(true);
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, , buttons] = alert.mock.calls[0];
    expect(title).toBe('要結束這段錄音嗎？');
    expect(buttons!.map((b) => b.text)).toEqual(['繼續錄音', '結束']);
    await act(async () => { buttons![0].onPress?.(); });
    expect(mockRecApi.stop).not.toHaveBeenCalled();
    expect(mockNav.goBack).not.toHaveBeenCalled();
  });

  test('結束 runs the normal stop: the take is saved and Review opens', async () => {
    mockRecApi.state = 'recording';
    const back = captureBack();
    const alert = jest.spyOn(Alert, 'alert');
    await render(<RecordScreen />);
    back.press();
    const buttons = alert.mock.calls[0][2]!;
    await act(async () => { buttons[1].onPress?.(); });
    expect(mockRecApi.stop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockNav.replace).toHaveBeenCalledWith('Review', { sessionId: expect.any(String) }));
    expect(mockStore.upsert).toHaveBeenCalledWith(expect.objectContaining({ parts: [{ uri: 'haoji/x/part-0.wav', durationMs: 1000 }] }));
  });

  test('on iOS there is no hardware back to handle', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    mockRecApi.state = 'recording';
    const back = captureBack();
    await render(<RecordScreen />);
    expect(back.count).toBe(0);
  });
});

// The header back button asks the same question on both platforms (#32 follow-up: Record had the
// native glass back button, the last shadow in the app, and it left a take without asking).
describe('Record header', () => {
  test('uses the flat ScreenHeader titled 錄音', async () => {
    const { getByTestId, getByText } = await render(<RecordScreen />);
    expect(getByTestId('screen-header')).toBeTruthy();
    expect(getByText('錄音')).toBeTruthy();
  });

  test('back while idle just goes back', async () => {
    const { getByLabelText } = await render(<RecordScreen />);
    const { fireEvent } = require('@testing-library/react-native');
    fireEvent.press(getByLabelText('返回'));
    expect(mockNav.goBack).toHaveBeenCalled();
  });

  test.each(['ios', 'android'])('on %s, back mid-take asks 「要結束這段錄音嗎？」 first', async (os) => {
    jest.replaceProperty(Platform, 'OS', os as any);
    mockRecApi.state = 'recording';
    const alert = jest.spyOn(Alert, 'alert');
    const { getByLabelText } = await render(<RecordScreen />);
    const { fireEvent } = require('@testing-library/react-native');
    fireEvent.press(getByLabelText('返回'));
    expect(alert.mock.calls[0][0]).toBe('要結束這段錄音嗎？');
    expect(mockNav.goBack).not.toHaveBeenCalled();
  });
});

describe('Processing', () => {
  test('back goes Home instead of to the screen that started the job', async () => {
    mockRoute.params = { sessionId: 's1' };
    const back = captureBack();
    await render(<ProcessingScreen />);
    let handled = false;
    await act(async () => { handled = back.press(); });
    expect(handled).toBe(true);
    expect(mockNav.popToTop).toHaveBeenCalled();
  });

  test('back is not taken while another screen sits on top (e.g. Pair)', async () => {
    mockRoute.params = { sessionId: 's1' };
    mockNav.isFocused.mockReturnValue(false);
    const back = captureBack();
    await render(<ProcessingScreen />);
    expect(back.press()).toBe(false);
    expect(mockNav.popToTop).not.toHaveBeenCalled();
  });
});
