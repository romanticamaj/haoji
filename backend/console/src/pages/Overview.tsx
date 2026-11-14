import { AudioLines, CircleAlert, Cpu, Layers, NotebookPen } from 'lucide-react';
import { api } from '../api';
import { Card } from '../components/Card';
import { OfflineCard, StaleBanner } from '../components/Offline';
import { Page } from '../components/Page';
import { ProgressBar } from '../components/ProgressBar';
import { StatusDot } from '../components/StatusDot';
import { mbToGb } from '../format';
import { usePoll } from '../usePoll';
import type { Check, StatusDetail } from '../types';

const fetchStatus = () => api.get<StatusDetail>('/api/status?detail=1');

export function Overview() {
  const { data, error, loading, refresh } = usePoll(fetchStatus);
  const retry = () => void refresh();

  return (
    <Page
      zh="總覽"
      en="Overview"
      lede={data ? `好記主機 ${data.version} · 每 3 秒更新` : '這台主機的狀態，每 3 秒更新。'}
      actions={data && <StatusDot state={data.ok ? 'ready' : 'working'} label={data.ok ? '一切就緒' : '還有設定沒完成'} />}
    >
      {!data && error ? <OfflineCard onRetry={retry} error={error} /> : null}
      {data && error ? <StaleBanner onRetry={retry} /> : null}
      {!data && loading ? <p className="muted">正在讀取主機狀態…</p> : null}
      {data && <Dashboard s={data} />}
    </Page>
  );
}

function check(s: StatusDetail, id: string): Check | undefined {
  return s.checks.find((c) => c.id === id);
}

function Dashboard({ s }: { s: StatusDetail }) {
  const failing = s.checks.filter((c) => !c.ok);
  const asr = check(s, 'breeze_asr');
  const ollama = check(s, 'ollama');
  const model = check(s, 'llm_model');
  const llmUp = s.llm.reachable && ollama?.ok !== false;

  return (
    <>
      {failing.length > 0 && <Checklist checks={failing} />}
      <div className="grid-2">
        <GpuCard gpu={s.gpu} />

        <Card title="語音辨識 ASR" icon={AudioLines} labelledBy="card-asr" action={<StatusDot state={asr?.ok ? 'ready' : 'offline'} />}>
          <div className="card-body">
            <p className="card-figure">Breeze ASR 25</p>
            <p className="card-meta mono">{s.asr?.base_url ?? asr?.message ?? '—'}</p>
            <p className="card-meta">講者分離由同一個容器處理。</p>
          </div>
        </Card>

        <Card
          title="會議記錄模型 Ollama"
          icon={NotebookPen}
          labelledBy="card-llm"
          action={<StatusDot state={!llmUp ? 'offline' : model?.ok === false ? 'working' : 'ready'} label={!llmUp ? '離線' : model?.ok === false ? '模型未安裝' : '正常'} />}
        >
          <div className="card-body">
            <p className="card-figure mono" style={{ fontSize: 18 }}>
              {s.llm.model}
            </p>
            <p className="card-meta mono">{ollama?.message || s.llm.base_url || '—'}</p>
          </div>
        </Card>

        <Card
          title="佇列 Queue"
          icon={Layers}
          labelledBy="card-queue"
          action={<StatusDot state={s.queue.active > 0 ? 'working' : 'ready'} label={s.queue.active > 0 ? '處理中' : '閒置'} />}
        >
          <div className="row" style={{ gap: 32 }}>
            <Stat n={s.queue.active} label="正在處理" />
            <Stat n={s.queue.queued} label="排隊中" />
          </div>
        </Card>
      </div>
    </>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <p className="card-figure num">{n}</p>
      <p className="card-meta">{label}</p>
    </div>
  );
}

function GpuCard({ gpu }: { gpu: StatusDetail['gpu'] }) {
  const ok = gpu?.available === true;
  const used = gpu?.vram_used_mb ?? 0;
  const total = gpu?.vram_total_mb ?? 0;
  return (
    <Card title="GPU" icon={Cpu} labelledBy="card-gpu" action={<StatusDot state={ok ? 'ready' : 'offline'} label={ok ? '可用' : '未偵測到'} />}>
      {ok ? (
        <div className="card-body">
          <p className="card-figure" style={{ fontSize: 18 }}>
            {gpu?.name ?? 'GPU'}
          </p>
          {total > 0 && (
            <>
              <ProgressBar value={used / total} label="VRAM 使用量" />
              <div className="row card-meta">
                <span className="num grow">
                  VRAM {mbToGb(used)} / {mbToGb(total)} GB
                </span>
                {gpu?.util_pct != null && <span className="num">使用率 {gpu.util_pct}%</span>}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="card-body">
          <p className="card-figure" style={{ fontSize: 18 }}>
            沒有偵測到 GPU（會用 CPU，較慢）
          </p>
          <p className="card-meta">確認主機裝好 NVIDIA 驅動和 nvidia-container-toolkit。</p>
        </div>
      )}
    </Card>
  );
}

function Checklist({ checks }: { checks: Check[] }) {
  return (
    <Card title="還差幾步" icon={CircleAlert} labelledBy="card-checklist">
      <p className="muted" style={{ marginBottom: 12 }}>
        下面這些完成後，手機就能把錄音整理成逐字稿和會議記錄。
      </p>
      <div className="checklist">
        {checks.map((c) => (
          <div className="check-row" key={c.id}>
            <span className="check-icon" aria-hidden>
              <CircleAlert size={14} strokeWidth={1.8} />
            </span>
            <div>
              <p className="notice-title">{c.label}</p>
              {c.hint && <p>{c.hint}</p>}
              {c.message && <p className="small muted mono">{c.message}</p>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
