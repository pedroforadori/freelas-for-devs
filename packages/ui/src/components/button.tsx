import type { ComponentProps } from 'react';
import { cn } from '../cn';

const variants = {
  primary: 'bg-dark text-white hover:bg-dark/90',
  outline: 'border border-dark text-dark hover:bg-surface',
  accent: 'bg-accent text-dark hover:brightness-95',
} as const;

export type ButtonVariant = keyof typeof variants;

export const buttonClasses = (variant: ButtonVariant = 'primary', className?: string): string =>
  cn(
    'inline-flex h-[68px] items-center justify-center rounded-button px-9 text-body font-normal transition',
    'disabled:pointer-events-none disabled:opacity-50',
    variants[variant],
    className,
  );

export type ButtonProps = ComponentProps<'button'> & { variant?: ButtonVariant };

export function Button({ variant = 'primary', className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses(variant, className)} {...props} />;
}
