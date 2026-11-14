import React from 'react';
import { Platform, Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { useAndroidBack } from '../useAndroidBack';
import { Sheet } from '../../components/Sheet';
import { captureBack } from '../../test-utils/backHandler';

afterEach(() => jest.restoreAllMocks());

function Screen({ onBack, enabled = true }: { onBack: () => boolean; enabled?: boolean }) {
  useAndroidBack(onBack, enabled);
  return <Text>screen</Text>;
}

test('on iOS nothing is registered (there is no hardware back)', async () => {
  const back = captureBack();
  await render(<Screen onBack={() => true} />);
  expect(back.count).toBe(0);
});

describe('on Android', () => {
  beforeEach(() => { jest.replaceProperty(Platform, 'OS', 'android'); });

  test('the handler runs on back; returning false lets navigation pop', async () => {
    const back = captureBack();
    const onBack = jest.fn().mockReturnValue(false);
    await render(<Screen onBack={onBack} />);
    expect(back.press()).toBe(false);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('disabled → not registered; unmount removes the listener', async () => {
    const back = captureBack();
    const { rerender, unmount } = await render(<Screen onBack={() => true} enabled={false} />);
    expect(back.count).toBe(0);
    await rerender(<Screen onBack={() => true} enabled />);
    expect(back.count).toBe(1);
    await unmount();
    expect(back.count).toBe(0);
  });

  test('the handler always sees the latest closure', async () => {
    const back = captureBack();
    const a = jest.fn().mockReturnValue(true);
    const b = jest.fn().mockReturnValue(true);
    const { rerender } = await render(<Screen onBack={a} />);
    await rerender(<Screen onBack={b} />);
    back.press();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  test('back closes an open sheet before the screen underneath sees it', async () => {
    const back = captureBack();
    const screenBack = jest.fn().mockReturnValue(false);
    const onClose = jest.fn();
    const { rerender } = await render(
      <>
        <Screen onBack={screenBack} />
        <Sheet title="匯入" onClose={onClose}><Text>內容</Text></Sheet>
      </>,
    );
    let handled = false;
    await act(async () => { handled = back.press(); });
    expect(handled).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screenBack).not.toHaveBeenCalled();

    // Once the sheet is gone, back reaches the screen.
    await rerender(<Screen onBack={screenBack} />);
    back.press();
    expect(screenBack).toHaveBeenCalledTimes(1);
  });
});
