import { ROUTES, type RouteId } from '../routes';
import { Wordmark } from './Wordmark';

export function Rail({ active }: { active: RouteId }) {
  return (
    <aside className="rail">
      <Wordmark sub="主機控制台" />
      <nav className="rail-nav" aria-label="主選單">
        {ROUTES.map(({ id, path, zh, en, icon: Icon }) => (
          <a key={id} className="rail-link" href={`#${path}`} aria-current={id === active ? 'page' : undefined}>
            <Icon size={18} strokeWidth={id === active ? 2 : 1.8} aria-hidden />
            <span>{zh}</span>
            <span className="en" aria-hidden>
              {en}
            </span>
          </a>
        ))}
      </nav>
      <p className="rail-foot small muted">錄音和逐字稿只留在手機上，這台主機處理完就刪除。</p>
    </aside>
  );
}
