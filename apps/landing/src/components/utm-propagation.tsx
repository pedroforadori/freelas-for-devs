'use client';

import { useEffect } from 'react';
import { rememberUtm, withUtm } from '@/lib/utm';

/** Leva os parâmetros da campanha para os links do app (`data-app-link`). Não renderiza nada. */
export function UtmPropagation() {
  useEffect(() => {
    const utm = rememberUtm(window.location.search);
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-app-link]')) {
      link.href = withUtm(link.getAttribute('href') ?? link.href, utm);
    }
  }, []);
  return null;
}
