import { AsyncLocalStorage } from 'node:async_hooks';

interface TraceStore {
  traceId: string;
}

const storage = new AsyncLocalStorage<TraceStore>();

export const TraceContext = {
  run<T>(traceId: string, fn: () => T): T {
    return storage.run({ traceId }, fn);
  },

  get(): string | undefined {
    return storage.getStore()?.traceId;
  },
};
