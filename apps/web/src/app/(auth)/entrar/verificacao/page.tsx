import type { Metadata } from 'next';
import { AuthShell } from '@/features/auth/auth-shell';
import { OAuthMfaStep } from '@/features/auth/login-form';

export const metadata: Metadata = { title: 'Verificação em duas etapas' };

export default function OAuthMfaPage() {
  return (
    <AuthShell
      title="Verificação em duas etapas"
      subtitle="Confirme que é você para concluir o login."
    >
      <OAuthMfaStep />
    </AuthShell>
  );
}
