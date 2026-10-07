'use client';

import { buttonClasses } from '@f4d/ui/components/button';
import { Alert } from '@f4d/ui/components/alert';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { RequireAuth } from '@/features/auth/require-auth';
import { useSession } from '@/features/auth/session';

/** Área administrativa: exige papel ADMIN e sessão confirmada com 2FA (a API também exige). */
export function AdminGate({ children }: { children: ReactNode }) {
  return (
    <RequireAuth roles={['ADMIN']}>
      <MfaCheck>{children}</MfaCheck>
    </RequireAuth>
  );
}

function MfaCheck({ children }: { children: ReactNode }) {
  const { me } = useSession();
  if (me && me.sessionAal < 2) {
    return (
      <Alert tone="error" title="Verificação em duas etapas necessária">
        <p>
          {me.mfaEnabled
            ? 'Sua sessão atual não foi confirmada com o segundo fator. Saia e entre novamente.'
            : 'Ative a verificação em duas etapas para usar o painel administrativo.'}
        </p>
        {!me.mfaEnabled ? (
          <Link href="/conta/seguranca" className={buttonClasses('primary', 'mt-3 h-12')}>
            Configurar agora
          </Link>
        ) : null}
      </Alert>
    );
  }
  return children;
}
