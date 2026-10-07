'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { type ReactNode, useEffect } from 'react';
import { meQueryKey } from '@/features/auth/session';
import { ensureCsrf, onSessionExpired } from '@/lib/api';
import { getQueryClient } from '@/lib/query-client';

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();

  useEffect(() => {
    void ensureCsrf();
    onSessionExpired(() => queryClient.setQueryData(meQueryKey, null));
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <NuqsAdapter>{children}</NuqsAdapter>
    </QueryClientProvider>
  );
}
