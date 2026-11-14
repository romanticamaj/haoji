import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ResultsHeader } from '../ResultsHeader';
import { fontScale } from '../../lib/theme';

const LONG = '第三季產品規劃與跨部門資源協調會議（含行銷、業務、研發與客服四個團隊的年度目標對齊）';

test('header truncates long title to one line and keeps … reachable', async () => {
  const onMore = jest.fn();
  const { getByText, getByRole } = await render(<ResultsHeader title={LONG} onBack={() => {}} onMore={onMore} />);
  const title = getByText(LONG);
  expect(title.props.numberOfLines).toBe(1);
  expect(title.props.ellipsizeMode).toBe('tail');
  // Chrome text grows with Dynamic Type, but only so far — the buttons must stay on screen.
  expect(title.props.maxFontSizeMultiplier).toBe(fontScale.chrome);
  await fireEvent.press(getByRole('button', { name: '更多動作' }));
  expect(onMore).toHaveBeenCalled();
});

test('back goes back', async () => {
  const onBack = jest.fn();
  const { getByRole } = await render(<ResultsHeader title="t" onBack={onBack} onMore={() => {}} />);
  await fireEvent.press(getByRole('button', { name: '返回' }));
  expect(onBack).toHaveBeenCalled();
});

test('the title is announced as the screen header', async () => {
  const { getByRole } = await render(<ResultsHeader title="週會" onBack={() => {}} onMore={() => {}} />);
  getByRole('header', { name: '週會' });
});
