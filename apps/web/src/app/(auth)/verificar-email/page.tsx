import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyEmail } from '@/features/auth/account-recovery';
import { AuthShell } from '@/features/auth/auth-shell';

export const metadata: Metadata = { title: 'Confirmar e-mail' };

export default function VerifyEmailPage() {
  return (
    <AuthShell title="Confirmar e-mail">
      <Suspense>
        <VerifyEmail />
      </Suspense>
    </AuthShell>
  );
}
