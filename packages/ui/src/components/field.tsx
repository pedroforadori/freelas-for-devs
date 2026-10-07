import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../cn';

const control =
  'w-full rounded-button border border-dark bg-bg px-5 py-4 text-body placeholder:text-muted ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-dark focus-visible:ring-offset-2 ' +
  'aria-[invalid=true]:border-red-600 disabled:opacity-50';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(control, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'min-h-32 resize-y', className)} {...props} />;
}

export interface FieldProps {
  /** id do controle: liga label, dica e erro (acessibilidade). */
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
  className?: string;
}

/** Rótulo + controle + dica + erro, com `aria-describedby` correto. */
export function Field({ id, label, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={id} className="text-body font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Props de acessibilidade para o controle dentro de um <Field>. */
export const fieldA11y = (id: string, error?: string, hint?: boolean) => ({
  id,
  'aria-invalid': error ? true : undefined,
  'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
});
