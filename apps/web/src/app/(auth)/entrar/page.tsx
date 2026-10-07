import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/features/auth/auth-shell';
import { LoginForm } from '@/features/auth/login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default function LoginPage() {
  return (
    <AuthShell title="Entrar" subtitle="Bem-vindo de volta.">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
