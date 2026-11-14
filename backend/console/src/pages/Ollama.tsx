import { useEffect, useState } from 'react';
import { Cable, PlugZap, Save } from 'lucide-react';
import { api, describeError } from '../api';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Field } from '../components/Field';
import { OfflineCard } from '../components/Offline';
import { Page } from '../components/Page';
import { StatusDot } from '../components/StatusDot';
import type { LlmTest, Settings } from '../types';

type TestResult = { ok: true; version: string; count: number } | { ok: false; text: string };

export function Ollama() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [url, setUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const s = await api.get<Settings>('/api/settings');
      setSettings(s);
      setUrl(s.ollama_base_url.value);
    } catch (e) {
      setLoadError(e);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const locked = settings?.ollama_base_url.locked === true;

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const r = await api.post<LlmTest>('/api/llm/test', { base_url: url.trim() });
      setTest(r.ok ? { ok: true, version: r.version, count: r.models.length } : { ok: false, text: [r.error.message, r.error.hint].filter(Boolean).join(' ') });
    } catch (e) {
      setTest({ ok: false, text: describeError(e, '沒有測試成功，請再試一次。') });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const s = await api.put<Settings>('/api/settings', { ollama_base_url: url.trim() });
      setSettings(s);
      setSaved(true);
    } catch (e) {
      setSaveError(describeError(e, '沒有儲存，原本的位址還在使用，請再試一次。'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page zh="連線" en="Ollama" lede="會議記錄由 Ollama 寫。預設用同一個 docker compose 裡的 ollama 容器，也可以指向另一台機器。">
      {loadError && !settings ? <OfflineCard onRetry={() => void load()} error={loadError} /> : null}
      <Card title="Ollama 連線" icon={Cable} labelledBy="ollama-title">
        <div className="card-body" style={{ gap: 16 }}>
          <Field
            id="ollama-url"
            label="Ollama 位址"
            locked={locked}
            hint={
              locked ? (
                <>
                  這個位址由 <code className="code">.env</code> 的 <code className="code">OLLAMA_BASE_URL</code> 決定，修改後重新啟動。
                </>
              ) : (
                <>預設是 {settings?.ollama_base_url.default ?? 'http://127.0.0.1:11434'}</>
              )
            }
          >
            <input
              id="ollama-url"
              className="input mono"
              value={url}
              disabled={locked || !settings}
              onChange={(e) => {
                setUrl(e.target.value);
                setSaved(false);
              }}
              spellCheck={false}
              autoComplete="off"
              aria-describedby="ollama-url-hint"
            />
          </Field>

          <div className="row">
            <Button icon={PlugZap} onClick={() => void runTest()} disabled={testing || !url.trim()}>
              {testing ? '測試中…' : '測試連線'}
            </Button>
            <Button variant="primary" icon={Save} onClick={() => void save()} disabled={locked || saving || !settings || !url.trim()}>
              {saving ? '儲存中…' : '儲存'}
            </Button>
            {saved && <span style={{ color: 'var(--primaryDark)' }}>已儲存。</span>}
          </div>

          {test?.ok === true && (
            <div className="notice" role="status">
              <StatusDot state="ready" label="連得上" />
              <span className="num muted">
                Ollama {test.version} · {test.count} 個模型
              </span>
            </div>
          )}
          {test?.ok === false && (
            <div className="notice" role="alert">
              <StatusDot state="offline" label="連不上" />
              <span>{test.text}</span>
            </div>
          )}
          {saveError && (
            <p className="inline-error" role="alert">
              {saveError}
            </p>
          )}
        </div>
      </Card>
    </Page>
  );
}
