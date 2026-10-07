'use client';

import type { Role } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { useSession } from './session';

/**
 * Proteção de UX no cliente: sem sessão, leva ao login e volta depois. A autorização real
 * acontece na API (RBAC + políticas); aqui só evitamos mostrar telas inúteis.
 */
export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { me, isLoading } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !me) router.replace(`/entrar?redirectTo=${encodeURIComponent(pathname)}`);
  }, [isLoading, me, pathname, router]);

  if (isLoading || !me) {
    return (
      <p className="p-8 text-body text-muted" role="status">
        Carregando…
      </p>
    );
  }
  if (roles && !roles.some((role) => me.roles.includes(role))) {
    return (
      <Alert tone="error" title="Sem acesso" className="m-8">
        Esta área não está disponível para o seu perfil.
      </Alert>
    );
  }
  return children;
}
