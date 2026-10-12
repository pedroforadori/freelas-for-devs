'use client';

import { unwrap } from '@f4d/api-client';
import type { Contract, Project } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Button, buttonClasses } from '@f4d/ui/components/button';
import Link from 'next/link';
import { Card } from '@f4d/ui/components/card';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { dateTime, formatPriceRange } from '@/features/projects/format';
import { projectKey } from '@/features/projects/queries';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';
import { useProjectContract } from './queries';

const brl = (cents: number) => formatPriceRange({ minCents: cents, maxCents: cents });

/** Quanto o cliente paga e quanto o dev recebe, conforme quem paga a comissão. */
export function AmountsTable({
  contract,
  viewer,
}: {
  contract: Contract;
  viewer: 'client' | 'freelancer';
}) {
  const { amounts } = contract;
  const extras = contract.outOfScope.some((request) => request.status === 'ACCEPTED_FUNDED');
  const settled = contract.status === 'SETTLED';
  const rows =
    viewer === 'client'
      ? [
          [
            extras ? 'Proposta + adicionais pagos' : 'Proposta escolhida',
            brl(amounts.proposalCents),
          ],
          ...(amounts.clientTotalCents > amounts.proposalCents
            ? [['Taxa da plataforma', brl(amounts.clientTotalCents - amounts.proposalCents)]]
            : []),
          [
            settled ? 'Total pago (dividido pela mediação)' : 'Total em custódia',
            brl(amounts.clientTotalCents),
          ],
        ]
      : [
          [
            extras ? 'Proposta + adicionais pagos' : 'Valor da proposta',
            brl(amounts.proposalCents),
          ],
          ...(amounts.freelancerNetCents < amounts.proposalCents
            ? [
                [
                  'Taxa da plataforma',
                  `− ${brl(amounts.proposalCents - amounts.freelancerNetCents)}`,
                ],
              ]
            : []),
          [
            settled ? 'Valor original (dividido pela mediação)' : 'Você recebe',
            brl(amounts.freelancerNetCents),
          ],
        ];
  return (
    <dl className="grid gap-2 text-body">
      {rows.map(([label, value], index) => (
        <div
          key={label}
          className={
            index === rows.length - 1
              ? 'flex justify-between border-t border-dark pt-2 font-medium'
              : 'flex justify-between'
          }
        >
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Cliente com proposta escolhida: pagar em custódia (checkout do provedor). */
export function PaymentCard({ project }: { project: Project }) {
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const confirming = params.get('pagamento') === 'confirmando';
  const query = useProjectContract(project.id, { confirming });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const contract = query.data;

  // Pagamento confirmado pelo webhook: o projeto passa a "em andamento".
  useEffect(() => {
    if (contract?.status === 'ACTIVE')
      void queryClient.invalidateQueries({ queryKey: projectKey(project.id) });
  }, [contract?.status, project.id, queryClient]);

  if (!contract) {
    return (
      <Card tone="accent" className="flex flex-col gap-2" aria-live="polite">
        <h2 className="text-h4 font-medium">Preparando o contrato…</h2>
        <p className="text-body">Leva só alguns segundos.</p>
      </Card>
    );
  }

  const pay = async () => {
    setError(null);
    setPending(true);
    try {
      const { url } = await unwrap(
        api.POST('/v1/contracts/{contractId}/checkout', {
          params: { path: { contractId: contract.id } },
        }),
      );
      window.location.assign(url);
    } catch (payError) {
      setError(errorMessage(payError));
      setPending(false);
    }
  };

  return (
    <Card tone="accent" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-h4 font-medium">
          {confirming
            ? 'Confirmando seu pagamento…'
            : `Contratar ${contract.freelancer.displayName}`}
        </h2>
        <p className="text-body">
          O valor fica em custódia na plataforma e só é liberado ao dev quando você aprovar a
          entrega final. Pague até {dateTime.format(new Date(contract.paymentDeadlineAt))}; depois
          disso a escolha é desfeita.
        </p>
      </div>
      <div className="rounded-[20px] border border-dark bg-bg p-4">
        <AmountsTable contract={contract} viewer="client" />
      </div>
      {confirming ? (
        <Alert aria-live="polite">
          Assim que o provedor confirmar (em segundos no cartão; Pix pode levar alguns minutos), o
          projeto começa automaticamente.
        </Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button className="self-start" disabled={pending} onClick={() => void pay()}>
        {pending
          ? 'Abrindo pagamento…'
          : contract.paymentInProgress
            ? 'Continuar pagamento'
            : 'Pagar com segurança'}
      </Button>
    </Card>
  );
}

/** Projeto em andamento ou concluído: atalho para a área do contrato. */
export function InProgressCard({
  project,
  viewer,
}: {
  project: Project;
  viewer: 'client' | 'freelancer';
}) {
  const query = useProjectContract(project.id);
  const contract = query.data;
  if (!contract) return null;
  const done = project.status === 'COMPLETED';
  const mediated = project.status === 'CLOSED_BY_DISPUTE';
  const disputed = contract.status === 'DISPUTED';
  return (
    <Card tone="accent" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium tracking-wide uppercase">
          {done
            ? 'Projeto concluído'
            : mediated
              ? 'Encerrado pela mediação'
              : 'Pagamento em custódia'}
        </p>
        <h2 className="text-h4 font-medium">
          {done
            ? 'Entrega final aprovada'
            : mediated
              ? 'A disputa foi decidida'
              : disputed
                ? 'Disputa em andamento'
                : viewer === 'client'
                  ? `${contract.freelancer.displayName} está trabalhando no seu projeto`
                  : 'Projeto em andamento'}
        </h2>
        <p className="text-body">
          {done
            ? 'Veja as entregas e avalie o trabalho na área do contrato.'
            : mediated
              ? 'Veja a decisão e os valores na área do contrato.'
              : disputed
                ? 'Os prazos estão pausados e o valor segue protegido. Acompanhe e envie sua versão na área do contrato.'
                : `Prazo combinado: ${contract.deadlineDays} dias. Acompanhe as entregas, revise e peça ajustes na área do contrato.`}
        </p>
      </div>
      <Link href={`/contratos/${contract.id}`} className={buttonClasses('primary', 'self-start')}>
        Abrir contrato
      </Link>
    </Card>
  );
}
