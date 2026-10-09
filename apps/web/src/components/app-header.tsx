'use client';

import { cn } from '@f4d/ui/cn';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { hasRole, useSession, useSignOut } from '@/features/auth/session';

export function AppHeader() {
  const { me } = useSession();
  const signOut = useSignOut();
  const pathname = usePathname();

  const links = [
    { href: '/painel', label: 'Painel', show: true },
    { href: '/projetos', label: 'Projetos', show: hasRole(me, 'CLIENT') },
    { href: '/convites', label: 'Convites', show: hasRole(me, 'FREELANCER') },
    { href: '/perfil', label: 'Perfil', show: hasRole(me, 'FREELANCER') || hasRole(me, 'CLIENT') },
    { href: '/admin/projetos', label: 'Admin', show: hasRole(me, 'ADMIN') },
    { href: '/conta/seguranca', label: 'Segurança', show: true },
  ].filter((link) => link.show);
  // "Admin" fica ativo em qualquer seção administrativa.
  const isActive = (href: string) =>
    pathname.startsWith(href.startsWith('/admin') ? '/admin' : href);

  return (
    <header className="border-b border-dark/10">
      <div className="mx-auto flex max-w-content flex-wrap items-center justify-between gap-4 px-4 py-5 md:px-0">
        <Link href="/painel" className="text-h4 font-medium">
          Freelas 4 Devs
        </Link>
        <nav aria-label="Principal" className="flex flex-wrap items-center gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? 'page' : undefined}
              className={cn(
                'rounded-pill px-3 py-1 text-body',
                isActive(link.href) ? 'bg-accent' : 'hover:bg-surface',
              )}
            >
              {link.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => void signOut()}
            className="px-3 py-1 text-body underline"
          >
            Sair
          </button>
        </nav>
      </div>
    </header>
  );
}
