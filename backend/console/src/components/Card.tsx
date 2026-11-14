import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function Card({
  title,
  icon: Icon,
  action,
  flush,
  className = '',
  children,
  labelledBy,
}: {
  title?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
  labelledBy?: string;
}) {
  return (
    <section className={`card ${flush ? 'card-flush' : ''} ${className}`.trim()} aria-labelledby={labelledBy}>
      {(title || action) && (
        <div className="card-head" style={flush ? { padding: '20px 20px 0' } : undefined}>
          {title && (
            <h2 className="card-title" id={labelledBy}>
              {Icon && <Icon size={16} strokeWidth={1.8} aria-hidden />}
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
