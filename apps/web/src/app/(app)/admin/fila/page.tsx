import type { Metadata } from 'next';
import { Suspense } from 'react';
import { QueuePage } from '@/features/admin/queue-page';

export const metadata: Metadata = { title: 'Admin · Fila' };

export default function Page() {
  return (
    <Suspense>
      <QueuePage />
    </Suspense>
  );
}
