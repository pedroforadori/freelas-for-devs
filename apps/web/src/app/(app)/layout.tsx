import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { RequireAuth } from '@/features/auth/require-auth';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppHeader />
      <main className="mx-auto flex max-w-content flex-col gap-10 px-4 py-10 md:px-0">
        {children}
      </main>
    </RequireAuth>
  );
}
