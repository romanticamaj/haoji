import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { PrimaryButton, SecondaryButton, DangerButton, Chip, Touchable } from '../Buttons';
import { BottomActionBar } from '../BottomActionBar';
import { AppText } from '../AppText';
import { IconFile } from '../icons';
import { colors } from '../../lib/theme';

afterEach(() => jest.restoreAllMocks());

const RIPPLE = { color: colors.primarySoft, borderless: false };
// RNTL 14 only exposes host elements; the ripple is a prop of the Pressable composite itself.
const pressables = async (ui: React.ReactElement) => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(ui); });
  // Pressable is memo(forwardRef(...)), so match the composite by the prop Touchable always passes.
  return r.root.findAll((n) => typeof n.type !== 'string' && !!n.props && 'android_ripple' in n.props && 'onPress' in n.props);
};
const pressedStyle = (p: any) => StyleSheet.flatten(typeof p.props.style === 'function' ? p.props.style({ pressed: true }) : p.props.style);

const buttons = () => (
  <>
    <PrimaryButton label="生成逐字稿" onPress={() => {}} />
    <SecondaryButton label="返回" onPress={() => {}} />
    <DangerButton label="刪除" onPress={() => {}} />
    <Chip label="1.5×" onPress={() => {}} />
    <Touchable accessibilityLabel="x" onPress={() => {}}><AppText>x</AppText></Touchable>
  </>
);
const bar = () => (
  <BottomActionBar
    left={{ label: '匯入', a11y: '匯入音檔或影片', Icon: IconFile, onPress: () => {} }}
    onRecord={() => {}}
    right={{ label: '設定', a11y: '設定與資料', Icon: IconFile, onPress: () => {} }}
  />
);

describe('on Android', () => {
  beforeEach(() => { jest.replaceProperty(Platform, 'OS', 'android'); });

  test.each([['buttons', buttons], ['bottom bar', bar]])('%s ripple in primarySoft and never dim', async (_n, ui) => {
    const ps = await pressables(ui());
    expect(ps.length).toBeGreaterThanOrEqual(3);
    for (const p of ps) {
      expect(p.props.android_ripple).toEqual(RIPPLE);
      expect(pressedStyle(p)?.opacity).toBeUndefined();
    }
  });

  test('AppText drops the extra font padding', async () => {
    const { getByText } = await render(<AppText>好記</AppText>);
    expect(StyleSheet.flatten(getByText('好記').props.style).includeFontPadding).toBe(false);
  });
});

describe('on iOS', () => {
  test.each([['buttons', buttons], ['bottom bar', bar]])('%s fade on press, no ripple', async (_n, ui) => {
    const ps = await pressables(ui());
    for (const p of ps) expect(p.props.android_ripple).toBeUndefined();
    // The plain buttons dim when pressed.
    if (ui === buttons) expect(pressedStyle(ps[0]).opacity).toBeLessThan(1);
  });

  test('AppText keeps the platform default', async () => {
    const { getByText } = await render(<AppText>好記</AppText>);
    expect(StyleSheet.flatten(getByText('好記').props.style).includeFontPadding).toBeUndefined();
  });
});
