import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Shared harness for hook unit tests. Every wrap gets its own
// QueryClient so cache mutations don't bleed between tests.
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

interface WrapperArgs {
  queryClient: QueryClient;
}

export function makeWrapper({ queryClient }: WrapperArgs) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}
