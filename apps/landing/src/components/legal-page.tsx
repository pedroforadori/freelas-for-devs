import type { ReactNode } from 'react';
import { cn } from '@f4d/ui/cn';
import { container, SiteFooter, SiteHeader } from './sections';

export function LegalPage({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt: string;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className={cn(container, 'flex max-w-[860px] flex-col gap-8 pt-16 md:pt-24')}>
        <h1 className="text-h2 font-medium">{title}</h1>
        <p className="w-fit rounded-pill border border-dark bg-surface px-3 py-1 text-sm">
          Versão preliminar · atualizada em {updatedAt}
        </p>
        <div className="flex flex-col gap-6 text-body leading-relaxed [&_h2]:pt-4 [&_h2]:text-h4 [&_h2]:font-medium [&_ul]:list-disc [&_ul]:pl-6">
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
