import type { ComponentProps } from 'react';
import { cn } from '../cn';

const tones = {
  surface: 'bg-surface text-dark',
  accent: 'bg-accent text-dark',
  dark: 'bg-dark text-white',
  white: 'bg-bg text-dark',
} as const;

export type CardProps = ComponentProps<'div'> & { tone?: keyof typeof tones };

/** Card com borda escura, cantos de 45px e sombra sólida. */
export function Card({ tone = 'surface', className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-dark p-8 shadow-brutal md:p-12',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
