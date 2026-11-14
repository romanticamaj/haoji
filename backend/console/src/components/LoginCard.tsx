import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { ApiError, login } from '../api';
import { Wordmark } from './Wordmark';

export function LoginCard({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(value);
      onLoggedIn();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(
        status === 401 || status === 403
          ? '金鑰不對，請再確認一次。'
          : status === 0
            ? '連不到主機，請確認後端正在執行，再試一次。'
            : '沒有登入成功，請再試一次。',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit} aria-labelledby="login-title">
        <Wordmark sub="主機控制台" />
        <div className="card-body">
          <h1 id="login-title" className="section-title">
            貼上管理金鑰 Admin token
          </h1>
          <p className="muted">這台主機只讓有金鑰的人管理。金鑰只存在這個分頁，關掉就會忘記。</p>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="admin-token">
            <KeyRound size={16} strokeWidth={1.8} aria-hidden />
            管理金鑰
          </label>
          <input
            id="admin-token"
            className="input mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby="token-hint"
          />
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <button className="btn btn-primary" type="submit" disabled={!value.trim() || busy}>
          {busy ? '登入中…' : '登入'}
        </button>

        <div id="token-hint" className="field-hint card-body">
          <p>金鑰在哪裡：</p>
          <p>
            在主機上執行 <code className="code">docker compose logs haoji-backend | grep "admin token"</code>
          </p>
          <p>
            或打開資料夾裡的 <code className="code">DATA_DIR/admin_token</code>
          </p>
        </div>
      </form>
    </div>
  );
}
