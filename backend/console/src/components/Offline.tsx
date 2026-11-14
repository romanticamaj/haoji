import { CloudOff, RotateCw, ShieldAlert } from 'lucide-react';
import { ApiError } from '../api';
import { Button } from './Button';

/** The backend refuses domain-name Hosts not listed in HAOJI_ALLOWED_HOSTS / HAOJI_PUBLIC_URLS. */
export const isForbiddenHost = (e: unknown): e is ApiError => e instanceof ApiError && e.code === 'forbidden_host';

/** Full-card state when the very first load failed: what failed, what is safe, what to do. */
export function OfflineCard({ onRetry, error }: { onRetry: () => void; error?: unknown }) {
  if (isForbiddenHost(error)) {
    return (
      <section className="card" aria-live="polite">
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <span className="check-icon" style={{ width: 40, height: 40 }} aria-hidden>
            <ShieldAlert size={20} strokeWidth={1.8} />
          </span>
          <div className="card-body grow">
            <h2 className="section-title">{error.message}</h2>
            {error.hint && <p>{error.hint}</p>}
            <div>
              <Button icon={RotateCw} onClick={onRetry}>
                重試
              </Button>
            </div>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="card" aria-live="polite">
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <span className="check-icon" style={{ width: 40, height: 40 }} aria-hidden>
          <CloudOff size={20} strokeWidth={1.8} />
        </span>
        <div className="card-body grow">
          <h2 className="section-title">連不到主機</h2>
          <p className="muted">
            控制台還開著，但主機沒有回應。手機上的錄音不受影響。確認主機上的 <code className="code">docker compose ps</code>{' '}
            都在執行，再試一次。
          </p>
          <div>
            <Button icon={RotateCw} onClick={onRetry}>
              重試
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Thin banner when a later poll failed: the last good data stays on screen. */
export function StaleBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="notice" role="status">
      <CloudOff size={16} strokeWidth={1.8} aria-hidden />
      <div className="grow">
        <span className="notice-title">連不到主機</span>
        <span className="muted">，下面是最後一次取得的狀態。</span>
      </div>
      <Button size="sm" variant="ghost" icon={RotateCw} onClick={onRetry}>
        重試
      </Button>
    </div>
  );
}
