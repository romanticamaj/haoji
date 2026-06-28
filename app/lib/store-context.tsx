import React, { createContext, useContext } from 'react';
import { SessionStore } from './store';
import { createAsyncStorageStore } from './store';

const StoreContext = createContext<SessionStore | null>(null);

export function StoreProvider({ store, children }: { store?: SessionStore; children: React.ReactNode }) {
  const value = React.useMemo(() => store ?? createAsyncStorageStore(), [store]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): SessionStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore must be used within StoreProvider');
  return s;
}
