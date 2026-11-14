import React from 'react';
import { render } from '@testing-library/react-native';
import { AppText } from '../AppText';
import { Chip, PrimaryButton } from '../Buttons';

// Issue #32 (d): in the simulator's accessibility tree every AppText showed up as two StaticText nodes
// with the same label and frame. The JS side must render ONE host <Text> per AppText, with no nested
// <Text> and no extra accessible wrapper repeating the label; this guards that.
//
// The second node is not from this code: under the New Architecture, RN 0.81's
// RCTParagraphComponentView returns isAccessibilityElement = NO but still answers accessibilityLabel
// (the text) and StaticText traits, and exposes ONE child UIAccessibilityElement with the same label
// and frame (RCTParagraphComponentAccessibilityProvider `firstElement`). XCUITest snapshots list both
// the container and its child; VoiceOver only lands on the child, so it reads the text once.
// Every host <Text> in the rendered JSON tree, nested ones included.
function hostTexts(node: any): any[] {
  if (!node || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(hostTexts);
  return [...(node.type === 'Text' ? [node] : []), ...hostTexts(node.children ?? [])];
}

test('a rendered AppText is exactly one accessible text node', async () => {
  const r = await render(<AppText>你好</AppText>);
  const texts = hostTexts(r.toJSON());
  expect(texts).toHaveLength(1);
  expect(texts[0].props.accessible).not.toBe(false);
  expect(r.getAllByText('你好')).toHaveLength(1);
});

test('inside a button, the label is still one text node (the button carries the role)', async () => {
  const r = await render(<><PrimaryButton label="連接" onPress={() => {}} /><Chip label="複製" onPress={() => {}} /></>);
  expect(hostTexts(r.toJSON())).toHaveLength(2);
  expect(r.getAllByText('連接')).toHaveLength(1);
  expect(r.getAllByText('複製')).toHaveLength(1);
});
