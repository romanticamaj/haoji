import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { Sheet } from '../Sheet';
import { OverflowMenu } from '../OverflowMenu';

// Issue #32 item 1: the scrim fades in while only the sheet slides up (translateY, motion.sheet with
// the shared ease-out), the modal draws under the status bar, and the last row has no divider.
function find(node: any, pred: (n: any) => boolean): any[] {
  if (!node || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap((n) => find(n, pred));
  return [...(pred(node) ? [node] : []), ...find(node.children ?? [], pred)];
}

test('the modal fades and is status-bar translucent; the sheet itself slides', async () => {
  const r = await render(<Sheet title="標題" onClose={() => {}} testID="sheet"><></></Sheet>);
  const modal = find(r.toJSON(), (n) => n.props?.animationType !== undefined)[0];
  expect(modal.props.animationType).toBe('fade');
  expect(modal.props.statusBarTranslucent).toBe(true);
  const sheet = r.getByTestId('sheet');
  const t = StyleSheet.flatten(sheet.props.style)?.transform ?? [];
  expect(t.some((x: any) => 'translateY' in x)).toBe(true);
});

test('overflow menu: every row but the last has a divider', async () => {
  const items = ['a', 'b', 'c'].map((k) => ({ key: k, label: k, onPress: () => {} }));
  const r = await render(<OverflowMenu title="選單" items={items} onClose={() => {}} />);
  const border = (k: string) => StyleSheet.flatten(r.getByTestId(`overflow-${k}`).props.style)?.borderBottomWidth ?? 0;
  expect(border('a')).toBeGreaterThan(0);
  expect(border('b')).toBeGreaterThan(0);
  expect(border('c')).toBe(0);
});

test('speaker sheet: no divider under the last speaker', async () => {
  const SpeakerSheet = require('../SpeakerSheet').default;
  const stats = ['A', 'B'].map((speaker, index) => ({ speaker, index, ms: 1000, turns: 1 }));
  const r = await render(<SpeakerSheet stats={stats} names={{}} onClose={() => {}} onCommit={() => {}} />);
  const border = (k: string) => StyleSheet.flatten(r.getByTestId(`speaker-row-${k}`).props.style)?.borderBottomWidth ?? 0;
  expect(border('A')).toBeGreaterThan(0);
  expect(border('B')).toBe(0);
});
