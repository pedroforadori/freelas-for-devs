import type { Metadata } from 'next';
import { SettingsPage } from '@/features/admin/settings-page';

export const metadata: Metadata = { title: 'Admin · Configurações' };

export default function Page() {
  return <SettingsPage />;
}
