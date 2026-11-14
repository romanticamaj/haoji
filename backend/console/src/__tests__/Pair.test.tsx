import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';
import { Pair } from '../pages/Pair';
import { clone, fx, mockFetch } from './helpers';

vi.mock('qrcode', async (importOriginal) => {
  const actual = (await importOriginal()) as { default: typeof import('qrcode') };
  return { default: { ...actual.default, toString: vi.fn(actual.default.toString) } };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(QRCode.toString).mockClear();
});

describe('Pair', () => {
  it('qr svg rendered with payload', async () => {
    mockFetch({ 'GET /api/pairing': { json: fx.pairing } });
    render(<Pair />);
    const qr = await screen.findByRole('img', { name: /配對 QR/ });
    await waitFor(() => expect(qr.querySelector('svg')).not.toBeNull());
    expect(vi.mocked(QRCode.toString)).toHaveBeenCalledWith(fx.pairing.qr_payload, expect.objectContaining({ type: 'svg' }));
    expect(screen.getByText('用手機相機掃描，好記會自動打開並連上這台主機。')).toBeInTheDocument();
    for (const u of fx.pairing.urls) expect(screen.getByText(u)).toBeInTheDocument();
  });

  it('copy url writes clipboard', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    mockFetch({ 'GET /api/pairing': { json: fx.pairing } });
    render(<Pair />);
    fireEvent.click(await screen.findByRole('button', { name: `複製 ${fx.pairing.urls[1]}` }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(fx.pairing.urls[1]));
    expect(await screen.findByText('已複製')).toBeInTheDocument();
  });

  it('rotate updates qr', async () => {
    const next = clone(fx.pairing);
    next.token = 'pTk_rotated';
    next.qr_payload = 'haoji://pair?url=http%3A%2F%2F100.64.0.5%3A7780&token=pTk_rotated';
    let rotated = false;
    const m = mockFetch({
      'GET /api/pairing': () => ({ json: rotated ? next : fx.pairing }),
      'POST /api/pairing/rotate': () => {
        rotated = true;
        return { json: { token: 'pTk_rotated' } };
      },
    });
    render(<Pair />);
    await screen.findByRole('img', { name: /配對 QR/ });
    fireEvent.click(screen.getByRole('button', { name: '換一組配對碼' }));
    expect(screen.getByText('換掉配對碼？')).toBeInTheDocument();
    expect(screen.getByText(/已配對的手機要重新掃描/)).toBeInTheDocument();
    expect(m.called('POST /api/pairing/rotate')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '換掉' }));
    await waitFor(() => expect(vi.mocked(QRCode.toString)).toHaveBeenCalledWith(next.qr_payload, expect.anything()));
    expect(m.called('POST /api/pairing/rotate')).toHaveLength(1);
    expect(screen.queryByText('換掉配對碼？')).not.toBeInTheDocument();
  });

  it('rotate can be cancelled', async () => {
    const m = mockFetch({ 'GET /api/pairing': { json: fx.pairing } });
    render(<Pair />);
    await screen.findByRole('img', { name: /配對 QR/ });
    fireEvent.click(screen.getByRole('button', { name: '換一組配對碼' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByText('換掉配對碼？')).not.toBeInTheDocument();
    expect(m.called('POST /api/pairing/rotate')).toHaveLength(0);
  });
});
