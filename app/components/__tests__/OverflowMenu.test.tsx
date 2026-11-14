import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { OverflowMenu } from '../OverflowMenu';
import { colors } from '../../lib/theme';

test('lists every action; pressing one closes the sheet and runs it', async () => {
  const onClose = jest.fn();
  const a = jest.fn();
  const b = jest.fn();
  const { getByRole } = await render(
    <OverflowMenu title="這場會議" onClose={onClose} items={[
      { key: 'a', label: '重新命名', onPress: a },
      { key: 'b', label: '刪除這場會議', onPress: b, danger: true },
    ]} />);
  await fireEvent.press(getByRole('button', { name: '重新命名' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).not.toHaveBeenCalled();
});

test('a danger row is drawn in the danger colour', async () => {
  const { getByText } = await render(
    <OverflowMenu title="這場會議" onClose={() => {}} items={[
      { key: 'd', label: '刪除這場會議', onPress: () => {}, danger: true },
    ]} />);
  const style = [getByText('刪除這場會議').props.style].flat(Infinity).reduce((acc: any, s: any) => ({ ...acc, ...(s || {}) }), {});
  expect(style.color).toBe(colors.danger);
});

test('a disabled row says why and does nothing', async () => {
  const run = jest.fn();
  const { getByRole, getByText } = await render(
    <OverflowMenu title="這場會議" onClose={() => {}} items={[
      { key: 'r', label: '重新生成逐字稿', onPress: run, disabled: true, hint: '主機沒有回應，錄音還在手機上。' },
    ]} />);
  const row = getByRole('button', { name: '重新生成逐字稿' });
  expect(row).toBeDisabled();
  getByText('主機沒有回應，錄音還在手機上。');
  await fireEvent.press(row);
  expect(run).not.toHaveBeenCalled();
});
