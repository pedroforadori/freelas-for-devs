import { Card } from '@f4d/ui/components/card';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Moldura das telas de autenticação: marca + cartão central (padrão visual Positivus). */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[560px] flex-col justify-center gap-8 px-4 py-12">
      <Link href="/" className="text-h4 font-medium">
        Freelas 4 Devs
      </Link>
      <Card tone="white" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-h3 font-medium">{title}</h1>
          {subtitle ? <p className="text-body text-muted">{subtitle}</p> : null}
        </div>
        {children}
      </Card>
    </main>
  );
}
