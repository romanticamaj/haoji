import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Jobs } from '../pages/Jobs';
import { clone, fx, mockFetch } from './helpers';

afterEach(() => vi.unstubAllGlobals());

describe('Jobs', () => {
  it('lists active and recent jobs with kind, status, progress and duration', async () => {
    mockFetch({ 'GET /api/jobs': { json: fx.jobs } });
    render(<Jobs />);
    const running = (await screen.findByText('a1b2c3')).closest('tr')!;
    expect(within(running).getByText('逐字稿')).toBeInTheDocument();
    expect(within(running).getByText('處理中')).toBeInTheDocument();
    expect(within(running).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');

    const done = screen.getByText('d4e5f6').closest('tr')!;
    expect(within(done).getByText('會議記錄')).toBeInTheDocument();
    expect(within(done).getByText('完成')).toBeInTheDocument();
    expect(within(done).getByText('18.5 秒')).toBeInTheDocument();

    const failed = screen.getByText('0a9b8c').closest('tr')!;
    expect(within(failed).getByText('失敗')).toBeInTheDocument();
    expect(failed.querySelector('.status-offline')).not.toBeNull(); // muted ring, never red
  });

  it('jobs renders no transcript text', async () => {
    const j = clone(fx.jobs) as { active: Record<string, unknown>[]; recent: Record<string, unknown>[] };
    // Even if a future backend leaked content, the console must not show it.
    j.active[0].transcript = '今天的會議我們討論了預算';
    j.active[0].title = '機密週會';
    j.recent[0].notes = '## 決議 下季加薪';
    mockFetch({ 'GET /api/jobs': { json: j } });
    const { container } = render(<Jobs />);
    await screen.findByText('a1b2c3');
    expect(container).not.toHaveTextContent('預算');
    expect(container).not.toHaveTextContent('機密週會');
    expect(container).not.toHaveTextContent('加薪');
  });

  it('expands the error inline', async () => {
    mockFetch({ 'GET /api/jobs': { json: fx.jobs } });
    render(<Jobs />);
    await screen.findByText('0a9b8c');
    expect(screen.queryByText('找不到 Breeze ASR server（port 7765）。')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /看原因/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('找不到 Breeze ASR server（port 7765）。')).toBeInTheDocument();
  });

  it('shows a calm empty state', async () => {
    mockFetch({ 'GET /api/jobs': { json: { active: [], recent: [] } } });
    render(<Jobs />);
    expect(await screen.findByText('目前沒有工作')).toBeInTheDocument();
  });
});
