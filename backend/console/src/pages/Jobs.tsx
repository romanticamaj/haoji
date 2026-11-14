import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, ListChecks } from 'lucide-react';
import { api } from '../api';
import { Card } from '../components/Card';
import { OfflineCard, StaleBanner } from '../components/Offline';
import { Page } from '../components/Page';
import { ProgressBar } from '../components/ProgressBar';
import { StatusDot, type StatusState } from '../components/StatusDot';
import { formatClock, formatDuration, formatRelative } from '../format';
import { usePoll } from '../usePoll';
import type { Job, Jobs as JobsT } from '../types';

const fetchJobs = () => api.get<JobsT>('/api/jobs');

const KIND: Record<Job['kind'], string> = { transcribe: '逐字稿', analyze: '會議記錄' };
const STATUS: Record<Job['status'], [StatusState, string]> = {
  queued: ['working', '排隊中'],
  running: ['working', '處理中'],
  done: ['ready', '完成'],
  error: ['offline', '失敗'],
};

export function Jobs() {
  const { data, error, refresh } = usePoll(fetchJobs);
  const retry = () => void refresh();
  const empty = data && data.active.length === 0 && data.recent.length === 0;

  return (
    <Page zh="工作" en="Jobs" lede="手機送來的錄音會在這裡排隊處理。這裡只看得到進度，看不到內容。">
      {!data && error ? <OfflineCard onRetry={retry} error={error} /> : null}
      {data && error ? <StaleBanner onRetry={retry} /> : null}
      {empty && (
        <Card>
          <div className="empty">
            <ListChecks size={28} strokeWidth={1.8} aria-hidden style={{ color: 'var(--hint)' }} />
            <p className="section-title" style={{ marginTop: 8 }}>
              目前沒有工作
            </p>
            <p className="muted">手機送出錄音後，會出現在這裡。</p>
          </div>
        </Card>
      )}
      {data && !empty && (
        <>
          <JobTable title="進行中" id="jobs-active" jobs={data.active} emptyText="現在沒有進行中的工作。" />
          <JobTable title="最近完成" id="jobs-recent" jobs={data.recent} emptyText="還沒有完成的工作。" />
        </>
      )}
    </Page>
  );
}

function JobTable({ title, id, jobs, emptyText }: { title: string; id: string; jobs: Job[]; emptyText: string }) {
  return (
    <Card flush title={title} labelledBy={id} action={<span className="small muted num">{jobs.length} 筆</span>}>
      <div className="table-scroll">
        {/* Fixed layout + shared widths so the 進行中 and 最近完成 tables line up column for column. */}
        <table className="table" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '14%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '13%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>時間</th>
              <th>編號</th>
              <th>類型</th>
              <th>狀態</th>
              <th>進度</th>
              <th className="right">耗時</th>
              <th className="right">
                <span className="visually-hidden">錯誤</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {emptyText}
                </td>
              </tr>
            )}
            {jobs.map((j) => (
              <JobRow key={`${j.id}:${j.kind}`} j={j} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Deliberately renders only id/kind/status/progress/timing/error — never message bodies, titles or text.
function JobRow({ j }: { j: Job }) {
  const [open, setOpen] = useState(false);
  const [state, word] = STATUS[j.status] ?? ['offline', j.status];
  const live = j.status === 'running' || j.status === 'queued';
  const errId = `err-${j.id}-${j.kind}`;
  return (
    <Fragment>
      <tr>
        <td className="num muted" title={formatClock(j.started_at)}>
          {formatRelative(j.started_at)}
        </td>
        <td className="mono">{j.id}</td>
        <td>{KIND[j.kind] ?? j.kind}</td>
        <td>
          <StatusDot state={state} label={word} />
        </td>
        <td>
          {live ? (
            <div className="row">
              <div className="grow">
                <ProgressBar value={j.pct} label={`${j.id} 進度`} tone="accent" />
              </div>
              <span className="num small muted" style={{ width: 36, textAlign: 'right' }}>
                {Math.round(j.pct * 100)}%
              </span>
            </div>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td className="right num muted">{formatDuration(j.duration_s)}</td>
        <td className="right">
          {j.error && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-expanded={open}
              aria-controls={errId}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <ChevronDown size={14} strokeWidth={1.8} aria-hidden /> : <ChevronRight size={14} strokeWidth={1.8} aria-hidden />}
              看原因
            </button>
          )}
        </td>
      </tr>
      {j.error && open && (
        <tr id={errId}>
          <td />
          <td colSpan={6}>
            <p className="inline-error">{j.error}</p>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
