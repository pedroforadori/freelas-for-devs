import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/features/auth/require-auth';
import { InvitationList } from '@/features/invitations/invitation-list';

export const metadata: Metadata = { title: 'Convites' };

export default function Page() {
  return (
    <RequireAuth roles={['FREELANCER']}>
      <Suspense>
        <InvitationList />
      </Suspense>
    </RequireAuth>
  );
}
