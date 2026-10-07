import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetPasswordForm } from '@/features/auth/account-recovery';
import { AuthShell } from '@/features/auth/auth-shell';

export const metadata: Metadata = { title: 'Nova senha' };

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Criar nova senha">
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
