/** 4_200_000_000 → "4.2 GB" (decimal, as Ollama reports sizes). */
export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}

/** nvidia-smi reports MiB. */
export const mbToGb = (mb: number) => (mb / 1024).toFixed(1);

/** 18.5 → "18.5 秒", 125 → "2 分 5 秒". */
export function formatDuration(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '—';
  if (s < 60) return `${s.toFixed(1).replace(/\.0$/, '')} 秒`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  if (m < 60) return rest ? `${m} 分 ${rest} 秒` : `${m} 分`;
  return `${Math.floor(m / 60)} 小時 ${m % 60} 分`;
}

/** Unix seconds → "剛剛" / "3 分鐘前" / "2 小時前" / "3 天前". */
export function formatRelative(ts: number | null | undefined, now = Date.now() / 1000): string {
  if (ts == null || !Number.isFinite(ts)) return '—';
  const d = Math.max(0, now - ts);
  if (d < 45) return '剛剛';
  if (d < 3600) return `${Math.round(d / 60)} 分鐘前`;
  if (d < 86400) return `${Math.round(d / 3600)} 小時前`;
  return `${Math.round(d / 86400)} 天前`;
}

/** Unix seconds → "11/14 13:20" (local), for the title attribute next to relative times. */
export function formatClock(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return '';
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
