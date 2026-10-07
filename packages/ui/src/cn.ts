import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Junta classes condicionais e resolve conflitos de utilitários Tailwind. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
