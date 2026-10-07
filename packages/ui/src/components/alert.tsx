import type { ReactNode } from 'react';
import { cn } from '../cn';

const tones = {
  info: 'bg-surface',
  success: 'bg-accent',
  error: 'bg-red-50 border-red-700 text-red-900',
} as const;

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof tones;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-[20px] border border-dark px-6 py-4', tones[tone], className)}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className="text-body">{children}</div> : null}
    </div>
  );
}
