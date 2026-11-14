export type StatusState = 'ready' | 'working' | 'offline';

const WORD: Record<StatusState, string> = { ready: '正常', working: '處理中', offline: '離線' };

/** Status is always a dot plus a word — sage ready, peach working, muted ring offline. Never red/green. */
export function StatusDot({ state, label }: { state: StatusState; label?: string }) {
  return (
    <span className={`status status-${state}`}>
      <span className="status-dot" aria-hidden />
      <span>{label ?? WORD[state]}</span>
    </span>
  );
}
