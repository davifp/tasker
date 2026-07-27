import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RealtimeProvider, useRealtime } from './RealtimeProvider';
import type { Socket } from 'socket.io-client';

// Minimal in-memory socket that records listeners and lets tests fire events.
function makeFakeSocket() {
  const handlers = new Map<string, ((payload: unknown) => void)[]>();
  let disconnected = false;
  const socket = {
    on(event: string, handler: (payload: unknown) => void) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return socket;
    },
    off() {
      return socket;
    },
    removeAllListeners() {
      handlers.clear();
    },
    connect() {
      const list = handlers.get('connect') ?? [];
      for (const h of list) h(undefined);
    },
    disconnect() {
      disconnected = true;
    },
    emit(event: string, payload: unknown) {
      const list = handlers.get(event) ?? [];
      for (const h of list) h(payload);
    },
    auth: {} as Record<string, string>,
    get disconnected() {
      return disconnected;
    },
  };
  return socket as unknown as Socket & {
    emit: (event: string, payload: unknown) => void;
    connect: () => void;
  };
}

function TestChild() {
  const { connected } = useRealtime();
  return <div data-testid="status">{connected ? 'connected' : 'idle'}</div>;
}

function renderWithProvider(overrides?: {
  ticketFetcher?: () => Promise<{ ticket: string; expiresAt: string }>;
  connectFactory?: (url: string, opts: { auth: Record<string, string> }) => Socket;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  return {
    client,
    invalidateSpy,
    ...render(
      <QueryClientProvider client={client}>
        <RealtimeProvider
          workspaceId="ws-1"
          workspaceSlug="acme"
          ticketFetcher={
            overrides?.ticketFetcher ??
            (() => Promise.resolve({ ticket: 't-abc', expiresAt: new Date().toISOString() }))
          }
          {...(overrides?.connectFactory ? { connectFactory: overrides.connectFactory } : {})}
        >
          <TestChild />
        </RealtimeProvider>
      </QueryClientProvider>,
    ),
  };
}

describe('RealtimeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the socket with the ticket and workspaceId, then flips connected=true on connect', async () => {
    let created: ReturnType<typeof makeFakeSocket> | null = null;
    let connectAuth: Record<string, string> | null = null;
    const connectFactory = (_url: string, opts: { auth: Record<string, string> }) => {
      connectAuth = opts.auth;
      created = makeFakeSocket();
      return created as unknown as Socket;
    };
    renderWithProvider({ connectFactory });

    await waitFor(() => expect(created).not.toBeNull());
    expect(connectAuth).toEqual({ ticket: 't-abc', workspaceId: 'ws-1' });

    act(() => {
      created!.connect();
    });
    expect(screen.getByTestId('status').textContent).toBe('connected');
  });

  it('invalidates all queries on reconnect so active views catch up with missed changes', async () => {
    let created: ReturnType<typeof makeFakeSocket> | null = null;
    const { invalidateSpy } = renderWithProvider({
      connectFactory: (_url, _opts) => {
        created = makeFakeSocket();
        return created as unknown as Socket;
      },
    });
    await waitFor(() => expect(created).not.toBeNull());
    act(() => created!.connect());
    expect(invalidateSpy).toHaveBeenCalledWith();
  });

  it('invalidates the mapped query keys when a task.updated event is received', async () => {
    let created: ReturnType<typeof makeFakeSocket> | null = null;
    const { invalidateSpy } = renderWithProvider({
      connectFactory: (_url, _opts) => {
        created = makeFakeSocket();
        return created as unknown as Socket;
      },
    });
    await waitFor(() => expect(created).not.toBeNull());
    act(() => {
      created!.emit('task.updated', {
        type: 'task.updated',
        workspaceId: 'ws-1',
        taskId: 't-1',
        payload: {},
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks', 'acme'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard', 'acme'] });
  });

  it('does not invalidate when the payload discriminator disagrees with the event name', async () => {
    let created: ReturnType<typeof makeFakeSocket> | null = null;
    const { invalidateSpy } = renderWithProvider({
      connectFactory: (_url, _opts) => {
        created = makeFakeSocket();
        return created as unknown as Socket;
      },
    });
    await waitFor(() => expect(created).not.toBeNull());
    invalidateSpy.mockClear();
    act(() => {
      // Server sent notification.new via the task.updated channel — reject.
      created!.emit('task.updated', {
        type: 'notification.new',
        workspaceId: 'ws-1',
        recipientUserId: 'u-1',
        notificationId: 'n-1',
      });
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
