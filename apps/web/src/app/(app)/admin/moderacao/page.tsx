import type { Metadata } from 'next';
import { ModerationPage } from '@/features/admin/moderation-page';

export const metadata: Metadata = { title: 'Admin · Moderação' };

export default function Page() {
  return <ModerationPage />;
}
