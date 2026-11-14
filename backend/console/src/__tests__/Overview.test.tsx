import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Overview } from '../pages/Overview';
import { clone, fx, json, mockFetch } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const KEY = 'GET /api/status?detail=1';

describe('Overview', () => {
  it('all green: four status cards, no setup checklist', async () => {
    mockFetch({ [KEY]: { json: fx.statusDetail } });
    render(<Overview />);
    expect(await screen.findByText('NVIDIA GeForce RTX 5070 Ti')).toBeInTheDocument();
    const gpu = screen.getByRole('region', { name: /GPU/ });
    expect(within(gpu).getByRole('progressbar', { name: /VRAM/ })).toHaveAttribute('aria-valuenow', '56');
    expect(within(gpu).getByText(/8\.9 \/ 15\.9 GB/)).toBeInTheDocument();
    expect(within(gpu).getByText(/12%/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /語音辨識/ })).toHaveTextContent('http://breeze-asr:7765');
    expect(screen.getByRole('region', { name: /會議記錄模型/ })).toHaveTextContent('gemma4:e4b-it-qat');
    expect(screen.getByRole('region', { name: /佇列/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /還差幾步/ })).not.toBeInTheDocument();
  });

  it('ollama down: shows its hint in the setup checklist', async () => {
    const s = clone(fx.statusDetail);
    s.ok = false;
    const ollama = s.checks.find((c) => c.id === 'ollama')!;
    ollama.ok = false;
    ollama.hint = '確認 ollama 容器有在執行：docker compose ps。';
    s.llm.reachable = false;
    mockFetch({ [KEY]: { json: s } });
    render(<Overview />);
    const list = await screen.findByRole('region', { name: /還差幾步/ });
    expect(within(list).getByText('Ollama')).toBeInTheDocument();
    expect(within(list).getByText(ollama.hint)).toBeInTheDocument();
    expect(within(list).queryByText('資料庫')).not.toBeInTheDocument(); // only failing checks
    expect(within(screen.getByRole('region', { name: /會議記錄模型/ })).getByText('離線')).toBeInTheDocument();
  });

  it('Overview offline state: says 連不到主機 with a retry, never a blank screen', async () => {
    let up = false;
    const fetchMock = vi.fn(async () => {
      if (!up) throw new TypeError('Failed to fetch');
      return json(200, fx.statusDetail);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Overview />);
    expect(await screen.findByText('連不到主機')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /總覽/ })).toBeInTheDocument();
    up = true;
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByText('NVIDIA GeForce RTX 5070 Ti')).toBeInTheDocument();
    expect(screen.queryByText('連不到主機')).not.toBeInTheDocument();
  });

  it('no GPU: says it will use the CPU', async () => {
    const s = clone(fx.statusDetail) as Record<string, unknown>;
    s.gpu = { available: false };
    mockFetch({ [KEY]: { json: s } });
    render(<Overview />);
    expect(await screen.findByText('沒有偵測到 GPU（會用 CPU，較慢）')).toBeInTheDocument();
  });

  it('tolerates a payload without gpu/server blocks', async () => {
    mockFetch({ [KEY]: { json: fx.status } });
    render(<Overview />);
    expect(await screen.findByRole('region', { name: /還差幾步/ })).toHaveTextContent(fx.status.checks[5].hint);
    expect(screen.getByText('沒有偵測到 GPU（會用 CPU，較慢）')).toBeInTheDocument();
  });

  it('queue card shows running and waiting counts', async () => {
    const s = clone(fx.statusDetail);
    s.queue = { active: 1, queued: 3 };
    mockFetch({ [KEY]: { json: s } });
    render(<Overview />);
    const q = await screen.findByRole('region', { name: /佇列/ });
    expect(within(q).getByText('1')).toBeInTheDocument();
    expect(within(q).getByText('3')).toBeInTheDocument();
    expect(within(q).getByText('處理中')).toBeInTheDocument();
  });
});
