import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { StatusDot } from '../components/StatusDot';
import { ProgressBar } from '../components/ProgressBar';
import { setToken } from '../api';
import { FakeEventSource, fx, mockFetch } from './helpers';

const okRoutes = {
  'GET /api/status?detail=1': { json: fx.statusDetail },
  'GET /api/models': { json: fx.models },
  'GET /api/settings': { json: fx.settings },
  'GET /api/jobs': { json: fx.jobs },
  'GET /api/pairing': { json: fx.pairing },
};

beforeEach(() => FakeEventSource.install());
afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

const RAIL = [
  ['總覽', '#/'],
  ['模型', '#/models'],
  ['連線', '#/ollama'],
  ['工作', '#/jobs'],
  ['配對手機', '#/pair'],
  ['設定', '#/settings'],
] as const;

describe('shell', () => {
  it('rail shows the wordmark and all six bilingual links', () => {
    mockFetch(okRoutes);
    render(<App />);
    const nav = screen.getByRole('navigation', { name: '主選單' });
    for (const [zh, href] of RAIL) {
      expect(within(nav).getByRole('link', { name: new RegExp(zh) })).toHaveAttribute('href', href);
    }
    expect(screen.getByRole('heading', { name: /好記 HAOJI/ })).toBeInTheDocument();
  });

  it('marks the active route with aria-current', async () => {
    mockFetch(okRoutes);
    window.location.hash = '#/models';
    render(<App />);
    const nav = screen.getByRole('navigation', { name: '主選單' });
    expect(within(nav).getByRole('link', { name: /模型/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: /總覽/ })).not.toHaveAttribute('aria-current');

    await act(async () => {
      window.location.hash = '#/jobs';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(within(nav).getByRole('link', { name: /工作/ })).toHaveAttribute('aria-current', 'page'));
    expect(within(nav).getByRole('link', { name: /模型/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 1, name: /工作/ })).toBeInTheDocument();
  });

  it('unknown routes fall back to the overview', () => {
    mockFetch(okRoutes);
    window.location.hash = '#/nope';
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: /總覽/ })).toBeInTheDocument();
  });

  it('any 401 swaps the console for the login card; logging in brings it back', async () => {
    let authed = false;
    const unauthorized = { status: 401, json: { error: { code: 'unauthorized', message: '需要管理金鑰', hint: '' } } };
    const m = mockFetch({
      'GET /api/status?detail=1': () => (authed ? { json: fx.statusDetail } : unauthorized),
      'POST /api/console/login': () => {
        authed = true;
        return { json: { ok: true } };
      },
    });
    render(<App />);
    const input = await screen.findByLabelText('管理金鑰');
    expect(screen.queryByRole('navigation', { name: '主選單' })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: ' adm \n' } });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    expect(await screen.findByRole('navigation', { name: '主選單' })).toBeInTheDocument();
    await waitFor(() => expect(m.called('GET /api/status?detail=1').length).toBeGreaterThanOrEqual(2));
  });
});

describe('StatusDot', () => {
  it.each([
    ['ready', '正常'],
    ['working', '處理中'],
    ['offline', '離線'],
  ] as const)('%s renders a dot plus the word %s', (state, word) => {
    const { container } = render(<StatusDot state={state} />);
    expect(screen.getByText(word)).toBeInTheDocument();
    expect(container.querySelector(`.status-${state} .status-dot`)).not.toBeNull();
  });

  it('accepts a custom label', () => {
    render(<StatusDot state="working" label="下載中" />);
    expect(screen.getByText('下載中')).toBeInTheDocument();
  });
});

describe('ProgressBar', () => {
  it('exposes the percentage to assistive tech and clamps', () => {
    render(<ProgressBar value={1.7} label="下載進度" />);
    const bar = screen.getByRole('progressbar', { name: '下載進度' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });
});
