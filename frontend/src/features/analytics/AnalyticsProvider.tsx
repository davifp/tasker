'use client';

import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { AnalyticsClient, AnalyticsEvent } from './emitter';
import { createAnalyticsClient } from './emitter';

const AnalyticsContext = createContext<AnalyticsClient | null>(null);

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const clientRef = useRef<AnalyticsClient | null>(null);
  const client = useMemo(() => {
    if (!clientRef.current) clientRef.current = createAnalyticsClient();
    return clientRef.current;
  }, []);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        void client.flush();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', () => void client.flush());
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [client]);

  return <AnalyticsContext.Provider value={client}>{children}</AnalyticsContext.Provider>;
}

export function useAnalytics(): (event: AnalyticsEvent) => void {
  const client = useContext(AnalyticsContext);
  return (event) => {
    if (!client) return;
    client.emit(event);
  };
}
