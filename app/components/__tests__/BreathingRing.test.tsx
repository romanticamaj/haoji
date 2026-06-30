import React from 'react';
import { render } from '@testing-library/react-native';
import BreathingRing from '../BreathingRing';

describe('BreathingRing', () => {
  it('renders without throwing when inactive', async () => {
    await render(<BreathingRing active={false} level={0} />);
  });

  it('renders without throwing when active with zero level', async () => {
    await render(<BreathingRing active={true} level={0} />);
  });

  it('renders without throwing when active with high level', async () => {
    await render(<BreathingRing active={true} level={1} />);
  });

  it('transitions from active to inactive without throwing', async () => {
    const { rerender } = await render(<BreathingRing active={true} level={0.5} />);
    rerender(<BreathingRing active={false} level={0} />);
  });
});
