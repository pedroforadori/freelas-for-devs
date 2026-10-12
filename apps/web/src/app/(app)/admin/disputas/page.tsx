import type { Metadata } from 'next';
import { DisputesPage } from '@/features/admin/disputes-page';

export const metadata: Metadata = { title: 'Admin · Disputas' };

export default function Page() {
  return <DisputesPage />;
}
