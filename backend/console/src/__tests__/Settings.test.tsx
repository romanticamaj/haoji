import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Settings } from '../pages/Settings';
import { clone, fx, mockFetch } from './helpers';

afterEach(() => vi.unstubAllGlobals());

describe('Settings', () => {
  it('shows read-only server facts', async () => {
    mockFetch({ 'GET /api/status?detail=1': { json: fx.statusDetail }, 'GET /api/settings': { json: fx.settings } });
    render(<Settings />);
    expect(await screen.findByText('7780')).toBeInTheDocument();
    expect(screen.getByText('1.0.0')).toBeInTheDocument();
    expect(screen.getAllByText('/data').length).toBeGreaterThan(0);
    expect(screen.getByText(/24 小時/)).toBeInTheDocument();
    expect(screen.getByText('未啟用')).toBeInTheDocument(); // push_enabled false
    expect(screen.getByText('http://ollama:11434')).toBeInTheDocument();
    expect(screen.getByText('由環境變數設定')).toBeInTheDocument(); // ollama_base_url locked
    expect(screen.getByText('不需要')).toBeInTheDocument(); // pairing_required false
  });

  it('says where the admin token lives (file source)', async () => {
    mockFetch({ 'GET /api/status?detail=1': { json: fx.statusDetail }, 'GET /api/settings': { json: fx.settings } });
    render(<Settings />);
    expect(await screen.findByText('docker compose exec haoji-backend cat /data/admin_token')).toBeInTheDocument();
  });

  it('says where the admin token lives (env source)', async () => {
    const s = clone(fx.statusDetail);
    s.server.admin_token_source = 'env';
    mockFetch({ 'GET /api/status?detail=1': { json: s }, 'GET /api/settings': { json: fx.settings } });
    render(<Settings />);
    expect(await screen.findByText('HAOJI_ADMIN_TOKEN')).toBeInTheDocument();
  });

  it('never shows an API key value, only whether it is set', async () => {
    const st = clone(fx.settings) as Record<string, unknown>;
    st.openai_api_key = { configured: true, locked: false, value: 'sk-SECRET' };
    mockFetch({ 'GET /api/status?detail=1': { json: fx.statusDetail }, 'GET /api/settings': { json: st } });
    const { container } = render(<Settings />);
    await screen.findByText('7780');
    expect(container).not.toHaveTextContent('sk-SECRET');
    expect(screen.getByText('已設定')).toBeInTheDocument();
  });
});
