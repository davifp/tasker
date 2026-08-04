'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { REALTIME_EVENT_NAMES, invalidateFor, type RealtimeEvent } from './eventBindings';

// Reads NEXT_PUBLIC_API_URL at module load so the browser bundle has the
// origin the WebSocket handshake should hit. Falls back to same-origin for
// tests where the env is absent.
function apiOrigin(): string {
  return (
    process.env['NEXT_PUBLIC_API_URL'] ??
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001')
  );
}

interface Ticket {
  ticket: string;
  expiresAt: string;
}

async function fetchTicket(): Promise<Ticket> {
  const response = await fetch('/api/rt/ticket', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Ticket request failed with ${response.status}`);
  }
  return (await response.json()) as Ticket;
}

interface RealtimeContextValue {
  socket: Socket | null;
  connected: boolean;
}

const RealtimeContext = createContext<RealtimeContextValue>({ socket: null, connected: false });

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}

interface RealtimeProviderProps {
  workspaceId: string;
  workspaceSlug: string;
  children: ReactNode;
  // Test seam — tests inject a fake connection factory instead of io().
  connectFactory?: (url: string, opts: { auth: Record<string, string> }) => Socket;
  ticketFetcher?: () => Promise<Ticket>;
}

export function RealtimeProvider({
  workspaceId,
  workspaceSlug,
  children,
  connectFactory,
  ticketFetcher,
}: RealtimeProviderProps): ReactNode {
  const queryClient = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  // Ref so re-renders don't re-run the connection effect below.
  const attemptedRefreshRef = useRef(false);
  // Track whether we have already seen a successful connect, so we only
  // invalidate on true *re*connects (not on the initial handshake).
  const hasConnectedBeforeRef = useRef(false);

  const resolvedFetchTicket = useCallback(async () => {
    return (ticketFetcher ?? fetchTicket)();
  }, [ticketFetcher]);

  const factory = useCallback(
    (url: string, opts: { auth: Record<string, string> }) => {
      if (connectFactory) return connectFactory(url, opts);
      return io(url, {
        transports: ['websocket'],
        withCredentials: false,
        auth: opts.auth,
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 5_000,
        reconnectionAttempts: Infinity,
      });
    },
    [connectFactory],
  );

  useEffect(() => {
    let disposed = false;
    let current: Socket | null = null;

    async function connect() {
      try {
        const ticket = await resolvedFetchTicket();
        if (disposed) return;
        current = factory(apiOrigin(), {
          auth: { ticket: ticket.ticket, workspaceId },
        });
        setSocket(current);

        current.on('connect', () => {
          attemptedRefreshRef.current = false;
          setConnected(true);
          // On reconnect (not the first connect) revalidate active queries
          // so the UI catches up with anything that happened while offline.
          if (hasConnectedBeforeRef.current) {
            void queryClient.invalidateQueries();
          }
          hasConnectedBeforeRef.current = true;
        });
        current.on('disconnect', () => setConnected(false));
        current.on('connect_error', async (err: Error) => {
          setConnected(false);
          if (attemptedRefreshRef.current) return;
          const message = err.message ?? '';
          // A stale ticket manifests as an auth-shaped error. Refresh once,
          // rebind the auth payload, and let socket.io reconnect on its own.
          if (/unauthoriz|ticket|auth/i.test(message)) {
            attemptedRefreshRef.current = true;
            try {
              const fresh = await resolvedFetchTicket();
              if (disposed || !current) return;
              current.auth = { ticket: fresh.ticket, workspaceId };
              current.connect();
            } catch {
              // Session is really gone; the app will surface it via the
              // normal request cycle. No further retries here.
            }
          }
        });

        for (const eventName of REALTIME_EVENT_NAMES) {
          current.on(eventName, (payload: unknown) => {
            const event = payload as RealtimeEvent;
            if (!event || event.type !== eventName) return;
            invalidateFor(event, queryClient, { workspaceSlug });
          });
        }
      } catch {
        // Ticket fetch failed (e.g. session gone). Leaving `connected` false
        // is enough — feature surfaces degrade to plain fetch behavior.
      }
    }

    void connect();

    return () => {
      disposed = true;
      current?.removeAllListeners();
      current?.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [workspaceId, workspaceSlug, factory, queryClient, resolvedFetchTicket]);

  const value = useMemo<RealtimeContextValue>(() => ({ socket, connected }), [socket, connected]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
