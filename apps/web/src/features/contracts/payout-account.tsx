'use client';

import { unwrap } from '@f4d/api-client';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button, buttonClasses } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { SectionHeading } from '@f4d/ui/components/section-heading';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';

const usePayoutAccount = () =>
  useQuery({
    queryKey: ['payout-account'],
    queryFn: () => unwrap(api.GET('/v1/me/payout-account')),
  });

/** Cadastro de recebimentos no provedor (dados bancários e identidade ficam com ele, não conosco). */
export function PayoutAccountPage() {
  const params = useSearchParams();
  const query = usePayoutAccount();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const start = async () => {
    setError(null);
    setPending(true);
    try {
      const { url } = await unwrap(api.POST('/v1/me/payout-account/onboarding'));
      window.location.assign(url);
    } catch (startError) {
      setError(errorMessage(startError));
      setPending(false);
    }
  };

  const account = query.data;
  return (
    <>
      <SectionHeading title="Recebimentos">
        Para receber os pagamentos dos projetos, cadastre seus dados bancários no nosso parceiro de
        pagamentos. A plataforma não armazena dados bancários nem documentos.
      </SectionHeading>
      {params.get('expirado') ? (
        <Alert tone="error">O link de cadastro expirou. Abra de novo para continuar.</Alert>
      ) : null}
      {query.isError ? <Alert tone="error">{errorMessage(query.error)}</Alert> : null}
      {account ? (
        <Card tone={account.payoutsEnabled ? 'accent' : 'surface'} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-h4 font-medium">Conta de recebimento</h2>
            <Badge tone={account.payoutsEnabled ? 'dark' : 'neutral'}>
              {account.payoutsEnabled
                ? 'Pronta para receber'
                : account.detailsSubmitted
                  ? 'Em análise'
                  : account.exists
                    ? 'Cadastro incompleto'
                    : 'Não configurada'}
            </Badge>
          </div>
          <p className="text-body">
            {account.payoutsEnabled
              ? 'Tudo certo: os repasses chegam na sua conta quando o cliente aprova a entrega final.'
              : 'Você pode receber convites e enviar propostas normalmente; o cadastro só é necessário antes do primeiro repasse.'}
          </p>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {!account.payoutsEnabled ? (
            <Button className="self-start" disabled={pending} onClick={() => void start()}>
              {pending
                ? 'Abrindo…'
                : account.exists
                  ? 'Continuar cadastro'
                  : 'Configurar recebimentos'}
            </Button>
          ) : null}
        </Card>
      ) : query.isPending ? (
        <p role="status">Carregando…</p>
      ) : null}
    </>
  );
}

/** Lembrete no painel do freelancer enquanto a conta de recebimento não estiver pronta. */
export function PayoutReminder() {
  const query = usePayoutAccount();
  if (!query.data || query.data.payoutsEnabled) return null;
  return (
    <Alert title="Configure seus recebimentos">
      <p>Cadastre seus dados bancários antes de concluir o primeiro projeto.</p>
      <Link href="/conta/recebimentos" className={buttonClasses('outline', 'mt-3 h-11 px-5')}>
        Configurar agora
      </Link>
    </Alert>
  );
}
