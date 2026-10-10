'use client';

import { unwrap } from '@f4d/api-client';
import { Alert } from '@f4d/ui/components/alert';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { safeRedirect } from '@/features/auth/session';
import { formatPriceRange } from '@/features/projects/format';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';

/** Substitui o checkout do provedor em desenvolvimento: aprova ou recusa o pagamento. */
export function SimulatedCheckout() {
  const params = useSearchParams();
  const router = useRouter();
  const checkoutId = params.get('checkout') ?? '';
  const amount = Number(params.get('valor') ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** Só caminhos internos: o retorno vem na URL e não pode virar redirecionamento aberto. */
  const backPath = (): string => {
    try {
      const url = new URL(params.get('retorno') ?? '/', window.location.origin);
      return safeRedirect(url.origin === window.location.origin ? url.pathname + url.search : null);
    } catch {
      return '/painel';
    }
  };

  const simulate = async (outcome: 'succeeded' | 'failed') => {
    const back = backPath();
    setError(null);
    setPending(true);
    try {
      await unwrap(api.POST('/v1/dev/payments/simulate', { body: { checkoutId, outcome } }));
      router.replace(outcome === 'succeeded' ? back : (back.split('?')[0] ?? '/painel'));
    } catch (simulateError) {
      setError(errorMessage(simulateError));
      setPending(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-[560px] flex-col justify-center gap-6 px-4 py-12">
      <Card tone="white" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium tracking-wide uppercase">Ambiente de desenvolvimento</p>
          <h1 className="text-h3 font-medium">Pagamento simulado</h1>
          <p className="text-body">
            Em produção, aqui fica o checkout do Stripe (cartão ou Pix). Escolha o resultado para
            testar o fluxo.
          </p>
        </div>
        <p className="text-h3 font-medium">
          {formatPriceRange({ minCents: amount, maxCents: amount })}
        </p>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex flex-wrap gap-3">
          <Button disabled={pending || !checkoutId} onClick={() => void simulate('succeeded')}>
            Aprovar pagamento
          </Button>
          <Button
            variant="outline"
            disabled={pending || !checkoutId}
            onClick={() => void simulate('failed')}
          >
            Recusar
          </Button>
        </div>
      </Card>
    </main>
  );
}
