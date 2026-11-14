import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { ScreenHeader } from '../ScreenHeader';
import { colors, layout } from '../../lib/theme';

// Issue #32 item 3: one flat header for Settings, Pair, Review and Processing — chevron 20 in a 44
// target, title 17/600, the canvas colour, no glass button and no shadow or rule.
declare const __dirname: string;
const fs: { readFileSync(p: string, enc: 'utf8'): string } = require('fs');
const path: { join(...p: string[]): string } = require('path');

test('back chevron (20) in a 44 pt target, title 17/600, flat', async () => {
  const onBack = jest.fn();
  const r = await render(<ScreenHeader title="設定" onBack={onBack} />);
  const back = r.getByRole('button', { name: '返回' });
  const b = StyleSheet.flatten(back.props.style);
  expect(b.width).toBe(layout.minTouchTarget);
  expect(b.height).toBe(layout.minTouchTarget);
  expect(b.backgroundColor).toBeUndefined();          // no glass / round button
  expect(b.borderWidth ?? 0).toBe(0);
  const sizes: unknown[] = [];
  const walk = (n: any): void => {
    if (!n || typeof n === 'string') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.props?.width !== undefined && n.props?.height !== undefined && n.props?.stroke !== undefined) sizes.push(n.props.width);
    walk(n.children);
  };
  walk(r.toJSON());
  expect(sizes).toEqual([20]);                         // the chevron, 20 pt
  const title = r.getByRole('header');
  expect(title).toHaveTextContent('設定');
  expect(title).toHaveStyle({ fontSize: 17, fontWeight: '600', color: colors.heading });
  const bar = StyleSheet.flatten(r.getByTestId('screen-header').props.style);
  expect(bar.backgroundColor).toBe(colors.background);
  expect(bar.borderBottomWidth ?? 0).toBe(0);
  await fireEvent.press(back);
  expect(onBack).toHaveBeenCalled();
});

test('no back button when there is nowhere to go back to (Review, Processing)', async () => {
  const r = await render(<ScreenHeader title="整理中" />);
  expect(r.queryByRole('button', { name: '返回' })).toBeNull();
  r.getByRole('header');
});

test('App: the four screens hide the native header and draw ScreenHeader', () => {
  const root = path.join(__dirname, '..', '..');
  const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  for (const name of ['Settings', 'Pair', 'Review', 'Processing']) {
    const line = app.split('\n').find((l) => l.includes(`name="${name}"`)) ?? '';
    expect(`${name}: ${line}`).toMatch(/headerShown: false/);
    const screen = fs.readFileSync(path.join(root, 'screens', `${name}Screen.tsx`), 'utf8');
    expect(screen).toMatch(/<ScreenHeader\b/);
  }
});
