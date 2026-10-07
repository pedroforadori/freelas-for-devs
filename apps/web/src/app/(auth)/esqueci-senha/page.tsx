import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/features/auth/account-recovery';
import { AuthShell } from '@/features/auth/auth-shell';

export const metadata: Metadata = { title: 'Esqueci minha senha' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Esqueci minha senha"
      subtitle="Enviaremos um link para você criar uma nova senha."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
