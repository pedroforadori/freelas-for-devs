import type { ReactNode } from 'react';
import { cn } from '../cn';

const tones = {
  neutral: 'bg-surface',
  accent: 'bg-accent',
  dark: 'bg-dark text-white',
} as const;

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: keyof typeof tones;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill border border-dark px-2 py-0.5 text-sm',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
