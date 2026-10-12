import type { Metadata } from 'next';
import { PrivacyPage } from '@/features/privacy/privacy-page';

export const metadata: Metadata = { title: 'Privacidade' };

export default function Page() {
  return <PrivacyPage />;
}
