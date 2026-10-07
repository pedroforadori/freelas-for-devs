import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface SectionHeadingProps {
  title: string;
  children?: ReactNode;
  id?: string;
  className?: string;
}

/** Título de seção em "pílula" lima com descrição ao lado (padrão Positivus). */
export function SectionHeading({ title, children, id, className }: SectionHeadingProps) {
  return (
    <div className={cn('flex flex-col gap-6 md:flex-row md:items-center md:gap-10', className)}>
      <h2 id={id} className="w-fit rounded-pill bg-accent px-2 text-h3 font-medium md:text-h2">
        {title}
      </h2>
      {children ? <p className="max-w-[580px] text-body">{children}</p> : null}
    </div>
  );
}
