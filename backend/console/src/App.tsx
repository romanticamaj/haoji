import { useEffect, useState, type ComponentType } from 'react';
import { onUnauthorized } from './api';
import { LoginCard } from './components/LoginCard';
import { Rail } from './components/Rail';
import { useRoute, type RouteId } from './routes';
import { Overview } from './pages/Overview';
import { Models } from './pages/Models';
import { Ollama } from './pages/Ollama';
import { Jobs } from './pages/Jobs';
import { Pair } from './pages/Pair';
import { Settings } from './pages/Settings';

const PAGES: Record<RouteId, ComponentType> = {
  overview: Overview,
  models: Models,
  ollama: Ollama,
  jobs: Jobs,
  pair: Pair,
  settings: Settings,
};

export function App() {
  const route = useRoute();
  const [needLogin, setNeedLogin] = useState(false);
  // Bumped after login so the current page remounts and refetches with the new credentials.
  const [session, setSession] = useState(0);

  useEffect(() => onUnauthorized(() => setNeedLogin(true)), []);

  if (needLogin) {
    return (
      <LoginCard
        onLoggedIn={() => {
          setNeedLogin(false);
          setSession((n) => n + 1);
        }}
      />
    );
  }

  const PageComponent = PAGES[route];
  return (
    <div className="shell">
      <Rail active={route} />
      <main className="content" id="main">
        <PageComponent key={`${route}:${session}`} />
      </main>
    </div>
  );
}
