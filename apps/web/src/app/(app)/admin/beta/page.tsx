import type { Metadata } from 'next';
import { BetaPage } from '@/features/admin/beta-page';

export const metadata: Metadata = { title: 'Admin · Beta' };

export default function Page() {
  return <BetaPage />;
}
