import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginCard } from '../components/LoginCard';
import { getToken, setToken } from '../api';
import { mockFetch } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

describe('LoginCard', () => {
  it('says where the admin token lives', () => {
    render(<LoginCard onLoggedIn={() => {}} />);
    expect(screen.getByText(/貼上管理金鑰/)).toBeInTheDocument();
    expect(screen.getByText('docker compose exec haoji-backend cat /data/admin_token')).toBeInTheDocument();
    expect(screen.getByText(/DATA_DIR\/admin_token/)).toBeInTheDocument();
    // The token is no longer printed in the logs; do not send people there.
    expect(screen.queryByText(/docker compose logs/)).not.toBeInTheDocument();
  });

  it('forbidden_host: shows the server hint instead of "wrong token"', async () => {
    mockFetch({
      'POST /api/console/login': {
        status: 403,
        json: {
          error: {
            code: 'forbidden_host',
            message: '這個網址沒有被允許。',
            hint: '把 haoji.example.com 加到 HAOJI_ALLOWED_HOSTS 後重新啟動。',
          },
        },
      },
    });
    render(<LoginCard onLoggedIn={() => {}} />);
    fireEvent.change(screen.getByLabelText('管理金鑰'), { target: { value: 'adm' } });
    fireEvent.click(screen.getByRole('button', { name: /登入/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('把 haoji.example.com 加到 HAOJI_ALLOWED_HOSTS 後重新啟動。');
    expect(alert).not.toHaveTextContent(/金鑰不對/);
  });

  it('login trims token', async () => {
    const m = mockFetch({ 'POST /api/console/login': { json: { ok: true } } });
    const done = vi.fn();
    render(<LoginCard onLoggedIn={done} />);
    fireEvent.change(screen.getByLabelText('管理金鑰'), { target: { value: '   adm-token-1   ' } });
    fireEvent.click(screen.getByRole('button', { name: /登入/ }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(m.calls[0].body).toEqual({ token: 'adm-token-1' });
    expect(getToken()).toBe('adm-token-1');
  });

  it('shows a calm inline error on a wrong token and keeps the input', async () => {
    mockFetch({ 'POST /api/console/login': { status: 401, json: { error: { code: 'unauthorized', message: 'x', hint: '' } } } });
    const done = vi.fn();
    render(<LoginCard onLoggedIn={done} />);
    const input = screen.getByLabelText('管理金鑰');
    fireEvent.change(input, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /登入/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/金鑰不對/);
    expect(done).not.toHaveBeenCalled();
    expect(input).toHaveValue('wrong');
  });

  it('disables 登入 until something is pasted', () => {
    render(<LoginCard onLoggedIn={() => {}} />);
    expect(screen.getByRole('button', { name: /登入/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('管理金鑰'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /登入/ })).toBeDisabled();
  });
});
