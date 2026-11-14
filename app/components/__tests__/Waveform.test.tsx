import React from 'react';
import { render } from '@testing-library/react-native';
import Waveform from '../Waveform';

describe('Waveform', () => {
  it('renders without throwing when inactive', async () => {
    await render(<Waveform level={0} active={false} />);
  });

  it('renders without throwing when active with zero level', async () => {
    await render(<Waveform level={0} active={true} />);
  });

  it('renders without throwing when active with non-zero level', async () => {
    await render(<Waveform level={0.75} active={true} />);
  });

  it('rerenders without throwing when level changes', async () => {
    const { rerender } = await render(<Waveform level={0.1} active={true} />);
    rerender(<Waveform level={0.8} active={true} />);
  });

  it('transitions from active to inactive without throwing', async () => {
    const { rerender } = await render(<Waveform level={0.5} active={true} />);
    rerender(<Waveform level={0} active={false} />);
  });
});
