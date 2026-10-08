'use client';

import { cn } from '@f4d/ui/cn';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin/projetos', label: 'Projetos' },
  { href: '/admin/freelancers', label: 'Freelancers' },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Administração" className="flex gap-2 border-b border-dark/10 pb-4">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={pathname.startsWith(link.href) ? 'page' : undefined}
          className={cn(
            'rounded-pill border border-dark px-4 py-1.5',
            pathname.startsWith(link.href) ? 'bg-dark text-white' : 'hover:bg-surface',
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
