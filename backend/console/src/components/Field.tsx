import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';

export function LockedBadge() {
  return (
    <span className="badge badge-quiet">
      <Lock size={12} strokeWidth={1.8} aria-hidden />
      由環境變數設定
    </span>
  );
}

export function Field({
  id,
  label,
  hint,
  locked,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  locked?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <div className="row">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        {locked && <LockedBadge />}
      </div>
      {children}
      {hint && (
        <div className="field-hint" id={`${id}-hint`}>
          {hint}
        </div>
      )}
    </div>
  );
}
