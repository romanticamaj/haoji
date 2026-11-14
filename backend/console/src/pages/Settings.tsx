import { useEffect, useState, type ReactNode } from 'react';
import { KeyRound, NotebookPen, Server } from 'lucide-react';
import { api } from '../api';
import { Card } from '../components/Card';
import { LockedBadge } from '../components/Field';
import { OfflineCard } from '../components/Offline';
import { Page } from '../components/Page';
import type { Settings as SettingsT, StatusDetail } from '../types';

export function Settings() {
  const [status, setStatus] = useState<StatusDetail | null>(null);
  const [settings, setSettings] = useState<SettingsT | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function load() {
    setError(null);
    try {
      const [s, st] = await Promise.all([api.get<StatusDetail>('/api/status?detail=1'), api.get<SettingsT>('/api/settings')]);
      setStatus(s);
      setSettings(st);
    } catch (e) {
      setError(e);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const server = status?.server;

  return (
    <Page zh="設定" en="Settings" lede="這台主機目前的設定。要修改的話，編輯 .env 後重新啟動 docker compose。">
      {error && !status ? <OfflineCard onRetry={() => void load()} error={error} /> : null}
      {status && settings && (
        <>
          <Card title="主機" icon={Server} labelledBy="settings-server">
            <dl className="facts">
              <Fact k="版本">
                <span className="num">{status.version}</span>
              </Fact>
              <Fact k="連接埠">
                <span className="num">{server?.port ?? '—'}</span>
              </Fact>
              <Fact k="資料夾">
                <span className="mono">{server?.data_dir ?? '—'}</span>
              </Fact>
              <Fact k="暫存檔">
                {server ? <span className="num">處理完就刪除；沒處理完的最多留 {server.retention_hours} 小時</span> : '—'}
              </Fact>
              <Fact k="推播通知 APNs">{server?.push_enabled ? '已啟用' : '未啟用'}</Fact>
              <Fact k="手機配對碼">{status.pairing_required ? '需要（HAOJI_REQUIRE_TOKEN=1）' : '不需要'}</Fact>
            </dl>
          </Card>

          <Card title="會議記錄" icon={NotebookPen} labelledBy="settings-llm">
            <dl className="facts">
              <Fact k="提供者">
                <Locked locked={settings.llm_provider.locked}>{settings.llm_provider.value}</Locked>
              </Fact>
              <Fact k="模型">
                <Locked locked={settings.llm_model.locked}>
                  <span className="mono">{settings.llm_model.value}</span>
                </Locked>
              </Fact>
              <Fact k="Ollama 位址">
                <Locked locked={settings.ollama_base_url.locked}>
                  <span className="mono">{settings.ollama_base_url.value}</span>
                </Locked>
              </Fact>
              {settings.openai_base_url.value && (
                <Fact k="OpenAI 相容位址">
                  <span className="mono">{settings.openai_base_url.value}</span>
                </Fact>
              )}
              <Fact k="API 金鑰">{settings.openai_api_key.configured ? '已設定' : '未設定'}</Fact>
            </dl>
          </Card>

          <Card title="管理金鑰" icon={KeyRound} labelledBy="settings-admin">
            <div className="card-body">
              {server?.admin_token_source === 'env' ? (
                <p>
                  由環境變數 <code className="code">HAOJI_ADMIN_TOKEN</code> 設定，在主機的 <code className="code">.env</code> 裡。
                </p>
              ) : (
                <>
                  <p>
                    在主機上執行 <code className="code">docker compose exec haoji-backend cat /data/admin_token</code> 取得管理金鑰。
                  </p>
                  <p className="muted">
                    不是用 Docker 安裝的話，金鑰在 <code className="code">{`${server?.data_dir ?? 'DATA_DIR'}/admin_token`}</code>。刪掉這個檔案再重新啟動，就會換一組新的。
                  </p>
                </>
              )}
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}

function Fact({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Locked({ locked, children }: { locked: boolean; children: ReactNode }) {
  return (
    <span className="row row-wrap">
      {children}
      {locked && <LockedBadge />}
    </span>
  );
}
