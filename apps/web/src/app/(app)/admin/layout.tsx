import type { ReactNode } from 'react';
import { AdminGate } from '@/features/admin/admin-gate';
import { AdminNav } from '@/features/admin/admin-nav';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminGate>
      <AdminNav />
      {children}
    </AdminGate>
  );
}
