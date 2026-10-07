import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/features/auth/auth-shell';
import { RegisterForm } from '@/features/auth/register-form';

export const metadata: Metadata = { title: 'Criar conta' };

export default function RegisterPage() {
  return (
    <AuthShell title="Criar conta" subtitle="Leva menos de um minuto.">
      <Suspense>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  );
}
