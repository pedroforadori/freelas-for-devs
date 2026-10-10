import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/features/auth/require-auth';
import { PayoutAccountPage } from '@/features/contracts/payout-account';

export const metadata: Metadata = { title: 'Recebimentos' };

export default function Page() {
  return (
    <RequireAuth roles={['FREELANCER']}>
      <Suspense>
        <PayoutAccountPage />
      </Suspense>
    </RequireAuth>
  );
}
