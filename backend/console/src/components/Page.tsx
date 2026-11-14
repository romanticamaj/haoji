import type { ReactNode } from 'react';

/** One big bilingual title per page, an optional muted lede, then the content. */
export function Page({ zh, en, lede, actions, children }: { zh: string; en: string; lede?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">
            {zh}
            <span className="en">{en}</span>
          </h1>
          {lede && <p className="page-lede">{lede}</p>}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}
