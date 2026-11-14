import React from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { useReducedMotion } from '../useReducedMotion';

function Probe() { return <Text>{useReducedMotion() ? 'reduced' : 'full'}</Text>; }

test('reports the system Reduce Motion setting and follows changes', async () => {
  let listener: ((v: boolean) => void) | undefined;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((_: string, cb: any) => {
    listener = cb; return { remove: jest.fn() };
  }) as any);
  const { findByText } = await render(<Probe />);
  await findByText('reduced');
  await act(async () => { listener?.(false); });
  await findByText('full');
});
