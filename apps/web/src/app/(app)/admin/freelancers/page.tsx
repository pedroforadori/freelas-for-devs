import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReviewQueue } from '@/features/admin/review-queue';

export const metadata: Metadata = { title: 'Admin · Freelancers' };

export default function Page() {
  return (
    <Suspense>
      <ReviewQueue />
    </Suspense>
  );
}
