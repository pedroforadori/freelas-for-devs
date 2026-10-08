import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * O tailwind-merge não conhece a escala tipográfica customizada do tema (`text-h1`…`text-body`)
 * e a confundiria com cor de texto — `cn('text-lead', 'text-white')` descartaria o tamanho.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: { text: ['h1', 'h2', 'h3', 'h4', 'lead', 'body'] },
  },
});

/** Junta classes condicionais e resolve conflitos de utilitários Tailwind. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
