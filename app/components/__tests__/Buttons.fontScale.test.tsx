import React from 'react';
import { render } from '@testing-library/react-native';
import { Chip, DangerButton, PrimaryButton, SecondaryButton } from '../Buttons';
import { fontScale } from '../../lib/theme';

// Buttons are chrome: at large Dynamic Type they stop at 1.3× so a toolbar row still fits (spec §5.3 G).
test.each([
  ['Primary', PrimaryButton], ['Secondary', SecondaryButton], ['Danger', DangerButton], ['Chip', Chip],
] as const)('%s label is capped at the chrome font scale', async (_name, Btn) => {
  const { getByText } = await render(<Btn label="按鈕" onPress={() => {}} />);
  expect(getByText('按鈕').props.maxFontSizeMultiplier).toBe(fontScale.chrome);
});
