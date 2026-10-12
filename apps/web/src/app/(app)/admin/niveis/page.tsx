import type { Metadata } from 'next';
import { LevelsPage } from '@/features/admin/levels-page';

export const metadata: Metadata = { title: 'Admin · Níveis' };

export default function Page() {
  return <LevelsPage />;
}
