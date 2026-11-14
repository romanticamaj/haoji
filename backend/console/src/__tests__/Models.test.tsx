import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Models } from '../pages/Models';
import { App } from '../App';
import { FakeEventSource, clone, fx, mockFetch } from './helpers';

beforeEach(() => FakeEventSource.install());
afterEach(() => vi.unstubAllGlobals());

const base = {
  'GET /api/models': { json: fx.models },
  'GET /api/settings': { json: fx.settings },
};

describe('Models', () => {
  it('lists ASR rows read-only and LLM rows with size and a select radio', async () => {
    mockFetch(base);
    render(<Models />);
    const asrRow = (await screen.findByText('Breeze ASR 25')).closest('tr')!;
    expect(within(asrRow).getByText('由 breeze-asr 容器管理')).toBeInTheDocument();
    expect(within(asrRow).queryByRole('radio')).not.toBeInTheDocument();
    expect(within(asrRow).queryByRole('button', { name: /刪除/ })).not.toBeInTheDocument();

    const qwen = screen.getByRole('radio', { name: /qwen3:8b/ });
    expect(qwen).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /gemma4:e4b-it-qat/ })).toBeChecked();
    expect(screen.getByText('4.2 GB')).toBeInTheDocument();
    expect(screen.getByText('5.2 GB')).toBeInTheDocument();
  });

  it('select model PUTs', async () => {
    const m = mockFetch({ ...base, 'PUT /api/settings': { json: fx.settings } });
    render(<Models />);
    fireEvent.click(await screen.findByRole('radio', { name: /qwen3:8b/ }));
    await waitFor(() => expect(m.called('PUT /api/settings')).toHaveLength(1));
    expect(m.called('PUT /api/settings')[0].body).toEqual({ llm_model: 'qwen3:8b' });
    await waitFor(() => expect(m.called('GET /api/models').length).toBeGreaterThanOrEqual(2));
  });

  it('disables selection when llm_model is locked by env', async () => {
    const s = clone(fx.settings);
    s.llm_model.locked = true;
    mockFetch({ ...base, 'GET /api/settings': { json: s } });
    render(<Models />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /qwen3:8b/ })).toBeDisabled());
    expect(screen.getByText('由環境變數設定')).toBeInTheDocument();
  });

  it('pull shows progress then success', async () => {
    const m = mockFetch({ ...base, 'POST /api/llm/pull': { status: 202, json: { ok: true } } });
    render(<Models />);
    const input = await screen.findByLabelText('模型名稱');
    fireEvent.change(input, { target: { value: '  qwen3:8b ' } });
    fireEvent.click(screen.getByRole('button', { name: '下載' }));
    await waitFor(() => expect(m.called('POST /api/llm/pull')).toHaveLength(1));
    expect(m.called('POST /api/llm/pull')[0].body).toEqual({ name: 'qwen3:8b' });

    const es = FakeEventSource.last();
    expect(es.url).toBe('/api/llm/pull/qwen3%3A8b/events');
    expect(screen.getByRole('button', { name: /下載/ })).toBeDisabled();

    // The backend seeds PULLS[name] with status "queued" before Ollama answers.
    act(() => es.emit({ name: 'qwen3:8b', status: 'queued', completed: 0, total: 0, pct: 0 }));
    expect(screen.getByText('準備下載…')).toBeInTheDocument();
    act(() => es.emit(fx.pullEvents[0]));
    expect(screen.getByText(/讀取清單/)).toBeInTheDocument();
    act(() => es.emit(fx.pullEvents[1]));
    expect(screen.getByRole('progressbar', { name: /下載進度/ })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText(/2\.6 \/ 5\.2 GB/)).toBeInTheDocument();
    act(() => es.emit(fx.pullEvents[2]));
    expect(await screen.findByText(/已下載「qwen3:8b」/)).toBeInTheDocument();
    expect(es.closed).toBe(true);
    // Form is ready for the next pull: input cleared and enabled, button back to 下載.
    expect(screen.getByLabelText('模型名稱')).toBeEnabled();
    expect(screen.getByLabelText('模型名稱')).toHaveValue('');
    expect(screen.getByRole('button', { name: '下載' })).toBeInTheDocument();
    await waitFor(() => expect(m.called('GET /api/models').length).toBeGreaterThanOrEqual(2));
  });

  it('pull error re-enables', async () => {
    mockFetch({ ...base, 'POST /api/llm/pull': { status: 202, json: { ok: true } } });
    render(<Models />);
    fireEvent.change(await screen.findByLabelText('模型名稱'), { target: { value: 'nope:1b' } });
    fireEvent.click(screen.getByRole('button', { name: '下載' }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.last();
    act(() => es.emit({ name: 'nope:1b', status: 'error', completed: 0, total: 0, pct: 0, error: 'pull model manifest: file does not exist' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/沒有下載成功/);
    expect(screen.getByRole('alert')).toHaveTextContent(/file does not exist/);
    expect(es.closed).toBe(true);
    expect(screen.getByRole('button', { name: '下載' })).toBeEnabled();
  });

  it('pull: a dropped event stream re-enables with a message', async () => {
    mockFetch({ ...base, 'POST /api/llm/pull': { status: 202, json: { ok: true } } });
    render(<Models />);
    fireEvent.change(await screen.findByLabelText('模型名稱'), { target: { value: 'qwen3:8b' } });
    fireEvent.click(screen.getByRole('button', { name: '下載' }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    act(() => FakeEventSource.last().fail());
    expect(await screen.findByRole('alert')).toHaveTextContent(/進度連線中斷/);
    expect(screen.getByRole('button', { name: '下載' })).toBeEnabled();
  });

  it('pull: a rejected start shows the server message', async () => {
    mockFetch({ ...base, 'POST /api/llm/pull': { status: 503, json: { error: { code: 'ollama_unreachable', message: '連不到 Ollama。', hint: '先到「連線」頁測試。' } } } });
    render(<Models />);
    fireEvent.change(await screen.findByLabelText('模型名稱'), { target: { value: 'qwen3:8b' } });
    fireEvent.click(screen.getByRole('button', { name: '下載' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('連不到 Ollama。');
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(screen.getByRole('button', { name: '下載' })).toBeEnabled();
  });

  it('delete asks inline first, then DELETEs', async () => {
    const m = mockFetch({ ...base, 'DELETE /api/llm/models/qwen3%3A8b': { json: { ok: true } } });
    render(<Models />);
    fireEvent.click(await screen.findByRole('button', { name: '刪除 qwen3:8b' }));
    expect(m.called('DELETE /api/llm/models/qwen3%3A8b')).toHaveLength(0);
    expect(screen.getByText('刪除「qwen3:8b」？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByText('刪除「qwen3:8b」？')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '刪除 qwen3:8b' }));
    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }));
    await waitFor(() => expect(m.called('DELETE /api/llm/models/qwen3%3A8b')).toHaveLength(1));
  });

  it('delete 409 shows message', async () => {
    mockFetch({
      ...base,
      'DELETE /api/llm/models/gemma4%3Ae4b-it-qat': {
        status: 409,
        json: { error: { code: 'model_in_use', message: '這個模型正在寫會議記錄，等工作完成再刪除。', hint: '' } },
      },
    });
    render(<Models />);
    fireEvent.click(await screen.findByRole('button', { name: '刪除 gemma4:e4b-it-qat' }));
    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('這個模型正在寫會議記錄，等工作完成再刪除。');
    expect(screen.getByRole('radio', { name: /gemma4:e4b-it-qat/ })).toBeInTheDocument();
  });

  it('a long model list scrolls inside its card and the rail stays', async () => {
    const many = clone(fx.models);
    for (let i = 0; i < 40; i++) {
      many.models.push({ id: `m${i}:7b`, kind: 'llm', name: `m${i}:7b`, state: 'ready', size_bytes: 4e9, managed_by: 'ollama', selected: false });
    }
    mockFetch({
      'GET /api/models': { json: many },
      'GET /api/settings': { json: fx.settings },
    });
    window.location.hash = '#/models';
    render(<App />);
    expect(await screen.findByText('m39:7b')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(42);
    expect(screen.getByRole('navigation', { name: '主選單' })).toBeInTheDocument();
    expect(screen.getByRole('table').closest('.table-scroll')).not.toBeNull();
  });
});
