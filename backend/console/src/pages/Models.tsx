import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { api, describeError } from '../api';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { LockedBadge } from '../components/Field';
import { OfflineCard, StaleBanner } from '../components/Offline';
import { Page } from '../components/Page';
import { ProgressBar } from '../components/ProgressBar';
import { StatusDot, type StatusState } from '../components/StatusDot';
import { formatBytes } from '../format';
import { usePoll } from '../usePoll';
import type { ModelRow, Models as ModelsT, PullEvent, Settings } from '../types';

const KIND: Record<ModelRow['kind'], string> = { asr: '語音辨識', diarization: '講者分離', llm: '會議記錄' };

const STATE: Record<ModelRow['state'], [StatusState, string]> = {
  ready: ['ready', '已安裝'],
  loaded: ['ready', '已載入'],
  downloading: ['working', '下載中'],
  missing: ['offline', '未安裝'],
  unknown: ['offline', '未知'],
};

const fetchModels = () => api.get<ModelsT>('/api/models');

export function Models() {
  const models = usePoll(fetchModels);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);

  useEffect(() => {
    api.get<Settings>('/api/settings').then(setSettings, () => {});
  }, []);

  const locked = settings?.llm_model.locked === true;
  const rows = models.data?.models ?? [];

  async function select(name: string) {
    setRowError(null);
    setSelecting(name);
    try {
      setSettings(await api.put<Settings>('/api/settings', { llm_model: name }));
    } catch (e) {
      setRowError(describeError(e, '沒有切換成功，原本的模型還在使用，請再試一次。'));
    } finally {
      setSelecting(null);
      void models.refresh();
    }
  }

  return (
    <Page zh="模型" en="Models" lede="語音辨識由 breeze-asr 容器管理；會議記錄模型來自 Ollama，可以在這裡下載、切換和刪除。">
      {!models.data && models.error ? <OfflineCard onRetry={() => void models.refresh()} error={models.error} /> : null}
      {models.data && models.error ? <StaleBanner onRetry={() => void models.refresh()} /> : null}

      <Card
        flush
        title="已安裝的模型"
        labelledBy="models-title"
        action={locked ? <LockedBadge /> : <span className="small muted">選一個用來寫會議記錄</span>}
      >
        {rowError && (
          <p className="inline-error" role="alert" style={{ padding: '0 20px 12px' }}>
            {rowError}
          </p>
        )}
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 56 }}>
                  <span className="visually-hidden">使用中</span>
                </th>
                <th>名稱</th>
                <th>用途</th>
                <th>狀態</th>
                <th className="right">大小</th>
                <th className="right">
                  <span className="visually-hidden">動作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <ModelTableRow
                  key={m.id}
                  m={m}
                  locked={locked}
                  busy={selecting !== null}
                  onSelect={() => void select(m.name)}
                  onDeleted={() => void models.refresh()}
                />
              ))}
              {models.data && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    還沒有任何模型。在下面輸入名稱下載一個。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <PullCard onDone={() => void models.refresh()} />
    </Page>
  );
}

function ModelTableRow({
  m,
  locked,
  busy,
  onSelect,
  onDeleted,
}: {
  m: ModelRow;
  locked: boolean;
  busy: boolean;
  onSelect: () => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLlm = m.kind === 'llm';
  const [state, word] = STATE[m.state] ?? STATE.unknown;

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      await api.del(`/api/llm/models/${encodeURIComponent(m.name)}`);
      setConfirming(false);
      onDeleted();
    } catch (e) {
      setError(describeError(e, '沒有刪除成功，模型還在，請再試一次。'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <tr>
      <td>
        {isLlm && (
          <input
            type="radio"
            name="llm_model"
            className="radio"
            checked={m.selected}
            disabled={locked || busy}
            onChange={onSelect}
            aria-label={`使用 ${m.name} 寫會議記錄`}
          />
        )}
      </td>
      <td>
        <span className={isLlm ? 'mono' : undefined} style={{ color: 'var(--heading)', fontWeight: 500 }}>
          {m.name}
        </span>
        {!isLlm && <p className="small muted">由 {m.managed_by} 容器管理</p>}
        {isLlm && m.selected && <p className="small" style={{ color: 'var(--primaryDark)' }}>正在使用</p>}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </td>
      <td className="muted">{KIND[m.kind] ?? m.kind}</td>
      <td>
        <StatusDot state={state} label={word} />
      </td>
      <td className="right num muted">{formatBytes(m.size_bytes)}</td>
      <td className="right">
        {isLlm &&
          (confirming ? (
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <span className="small">刪除「{m.name}」？</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={deleting}>
                取消
              </Button>
              <Button size="sm" variant="danger" onClick={() => void remove()} disabled={deleting} aria-label="確認刪除">
                {deleting ? '刪除中…' : '刪除'}
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              aria-label={`刪除 ${m.name}`}
              title="刪除"
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
            />
          ))}
      </td>
    </tr>
  );
}

const PULL_WORD: [RegExp, string][] = [
  [/^pulling manifest/, '讀取清單…'],
  [/^(downloading|pulling)/, '下載中…'],
  [/^verifying/, '驗證檔案…'],
  [/^writing/, '寫入中…'],
  [/^success/, '完成'],
];
const pullWord = (s: string) => PULL_WORD.find(([re]) => re.test(s))?.[1] ?? s;

function PullCard({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [pulling, setPulling] = useState<string | null>(null);
  const [ev, setEv] = useState<PullEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const close = useRef<(() => void) | null>(null);

  useEffect(() => () => close.current?.(), []);

  function finish() {
    close.current?.();
    close.current = null;
    setPulling(null);
  }

  async function start(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || pulling) return;
    setError(null);
    setDone(null);
    setEv(null);
    setPulling(n);
    try {
      await api.post('/api/llm/pull', { name: n });
    } catch (err) {
      setError(describeError(err, '沒有開始下載，請再試一次。'));
      setPulling(null);
      return;
    }
    close.current = api.events<PullEvent>(
      `/api/llm/pull/${encodeURIComponent(n)}/events`,
      (msg) => {
        setEv(msg);
        if (msg.status === 'success') {
          finish();
          setDone(n);
          setName('');
          onDone();
        } else if (msg.status === 'error') {
          finish();
          setError(`沒有下載成功「${n}」。${msg.error ?? msg.message ?? '確認名稱是否正確，再試一次。'}`);
        }
      },
      () => {
        finish();
        setError('進度連線中斷。下載可能還在主機上繼續，稍後重新整理看看。');
      },
    );
  }

  const showProgress = pulling && ev && ev.status !== 'error';

  return (
    <Card title="下載模型" icon={Download} labelledBy="pull-title">
      <form className="card-body" onSubmit={start}>
        <label className="field-label" htmlFor="pull-name">
          模型名稱
        </label>
        <div className="row">
          <input
            id="pull-name"
            className="input mono grow"
            placeholder="例如 qwen3:8b"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!!pulling}
            spellCheck={false}
            autoComplete="off"
          />
          <Button type="submit" variant="primary" icon={Download} disabled={!!pulling || !name.trim()}>
            {pulling ? '下載中…' : '下載'}
          </Button>
        </div>
        <p className="field-hint">
          名稱和 Ollama 一樣，可以到{' '}
          <a href="https://ollama.com/library" target="_blank" rel="noreferrer" style={{ color: 'var(--primaryDark)' }}>
            ollama.com/library
          </a>{' '}
          找。下載時可以離開這頁。
        </p>

        {showProgress && (
          <div className="card-body" aria-live="polite" style={{ marginTop: 8 }}>
            <ProgressBar value={ev.pct} label={`下載進度 ${pulling}`} />
            <div className="row card-meta">
              <span className="grow">{pullWord(ev.status)}</span>
              {ev.total > 0 && (
                <span className="num">
                  {(ev.completed / 1e9).toFixed(1)} / {(ev.total / 1e9).toFixed(1)} GB · {Math.round(ev.pct * 100)}%
                </span>
              )}
            </div>
          </div>
        )}
        {pulling && !ev && <p className="card-meta">準備下載…</p>}
        {done && (
          <p role="status" style={{ color: 'var(--primaryDark)' }}>
            已下載「{done}」，可以在上面選它來寫會議記錄。
          </p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Card>
  );
}
