import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SimulatedCheckout } from '@/features/contracts/simulated-checkout';

export const metadata: Metadata = { title: 'Pagamento simulado' };

/** Só em desenvolvimento (PAYMENTS_PROVIDER=fake): a API recusa a simulação nos demais casos. */
export default function Page() {
  return (
    <Suspense>
      <SimulatedCheckout />
    </Suspense>
  );
}
