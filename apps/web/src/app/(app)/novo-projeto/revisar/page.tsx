import type { Metadata } from 'next';
import { RequireAuth } from '@/features/auth/require-auth';
import { ReviewAndPublish } from '@/features/projects/review-and-publish';

export const metadata: Metadata = { title: 'Revisar e publicar' };

export default function Page() {
  return (
    <RequireAuth roles={['CLIENT']}>
      <ReviewAndPublish />
    </RequireAuth>
  );
}
