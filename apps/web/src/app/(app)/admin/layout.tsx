import type { ReactNode } from 'react';
import { AdminGate } from '@/features/admin/admin-gate';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
