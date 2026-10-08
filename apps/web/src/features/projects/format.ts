import type { ClientEstimate } from '@f4d/contracts';

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

export const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

/** "R$ 4.000 a R$ 9.000" (valores em centavos). */
export const formatPriceRange = ({ minCents, maxCents }: ClientEstimate['priceRange']): string =>
  minCents === maxCents
    ? brl.format(minCents / 100)
    : `${brl.format(minCents / 100)} a ${brl.format(maxCents / 100)}`;

/** "20 a 40 dias" — prazos em dias corridos. */
export const formatDuration = ({ min, max }: ClientEstimate['durationDays']): string =>
  min === max ? `${min} dias` : `${min} a ${max} dias`;

export const formatFileSize = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
