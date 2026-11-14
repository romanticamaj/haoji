import { useEffect, useState } from 'react';
import { Activity, Boxes, Cable, ListChecks, QrCode, Settings2, type LucideIcon } from 'lucide-react';

export type RouteId = 'overview' | 'models' | 'ollama' | 'jobs' | 'pair' | 'settings';

export const ROUTES: { id: RouteId; path: string; zh: string; en: string; icon: LucideIcon }[] = [
  { id: 'overview', path: '/', zh: '總覽', en: 'Overview', icon: Activity },
  { id: 'models', path: '/models', zh: '模型', en: 'Models', icon: Boxes },
  { id: 'ollama', path: '/ollama', zh: '連線', en: 'Ollama', icon: Cable },
  { id: 'jobs', path: '/jobs', zh: '工作', en: 'Jobs', icon: ListChecks },
  { id: 'pair', path: '/pair', zh: '配對手機', en: 'Pair', icon: QrCode },
  { id: 'settings', path: '/settings', zh: '設定', en: 'Settings', icon: Settings2 },
];

export function routeFromHash(hash: string): RouteId {
  const path = hash.replace(/^#/, '') || '/';
  return ROUTES.find((r) => r.path === path)?.id ?? 'overview';
}

export function useRoute(): RouteId {
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
