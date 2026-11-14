import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ollama } from '../pages/Ollama';
import { clone, fx, mockFetch } from './helpers';

afterEach(() => vi.unstubAllGlobals());

function unlocked() {
  const s = clone(fx.settings);
  s.ollama_base_url = { value: 'http://192.168.1.30:11434', locked: false, default: 'http://127.0.0.1:11434' };
  return s;
}

describe('Ollama connection', () => {
  it('locked field disabled', async () => {
    mockFetch({ 'GET /api/settings': { json: fx.settings } });
    render(<Ollama />);
    const input = await screen.findByLabelText('Ollama 位址');
    await waitFor(() => expect(input).toHaveValue('http://ollama:11434'));
    expect(input).toBeDisabled();
    expect(screen.getByText('由環境變數設定')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '儲存' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '測試連線' })).toBeEnabled();
  });

  it('test connection ok: shows version and model count', async () => {
    const m = mockFetch({ 'GET /api/settings': { json: unlocked() }, 'POST /api/llm/test': { json: fx.llmTest } });
    render(<Ollama />);
    const input = await screen.findByLabelText('Ollama 位址');
    await waitFor(() => expect(input).toHaveValue('http://192.168.1.30:11434'));
    fireEvent.change(input, { target: { value: ' http://10.0.0.2:11434 ' } });
    fireEvent.click(screen.getByRole('button', { name: '測試連線' }));
    const result = await screen.findByRole('status');
    expect(result).toHaveTextContent('連得上');
    expect(result).toHaveTextContent('0.12.3');
    expect(result).toHaveTextContent('2 個模型');
    expect(m.called('POST /api/llm/test')[0].body).toEqual({ base_url: 'http://10.0.0.2:11434' });
  });

  it('test connection unreachable: shows what failed and the hint', async () => {
    mockFetch({
      'GET /api/settings': { json: unlocked() },
      'POST /api/llm/test': {
        json: { ok: false, error: { code: 'ollama_unreachable', message: '連不到 Ollama。', hint: '確認位址和連接埠 11434。' } },
      },
    });
    render(<Ollama />);
    await screen.findByDisplayValue('http://192.168.1.30:11434');
    fireEvent.click(screen.getByRole('button', { name: '測試連線' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('連不到 Ollama。');
    expect(alert).toHaveTextContent('確認位址和連接埠 11434。');
  });

  it('save PUTs the trimmed base URL and confirms', async () => {
    const m = mockFetch({ 'GET /api/settings': { json: unlocked() }, 'PUT /api/settings': { json: unlocked() } });
    render(<Ollama />);
    const input = await screen.findByDisplayValue('http://192.168.1.30:11434');
    fireEvent.change(input, { target: { value: 'http://10.0.0.2:11434\n' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(m.called('PUT /api/settings')).toHaveLength(1));
    expect(m.called('PUT /api/settings')[0].body).toEqual({ ollama_base_url: 'http://10.0.0.2:11434' });
    expect(await screen.findByText('已儲存。')).toBeInTheDocument();
  });

  it('save error keeps the typed value and shows the message', async () => {
    mockFetch({
      'GET /api/settings': { json: unlocked() },
      'PUT /api/settings': { status: 422, json: { error: { code: 'invalid_setting', message: '位址要以 http:// 或 https:// 開頭。', hint: '' } } },
    });
    render(<Ollama />);
    const input = await screen.findByDisplayValue('http://192.168.1.30:11434');
    fireEvent.change(input, { target: { value: 'ollama:11434' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('位址要以 http:// 或 https:// 開頭。');
    expect(input).toHaveValue('ollama:11434');
  });
});
