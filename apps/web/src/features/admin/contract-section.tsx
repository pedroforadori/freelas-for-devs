'use client';

import { ApiError, unwrap } from '@f4d/api-client';
import { CONTRACT_CHAT_STATUSES, CONTRACT_STATUS_LABELS } from '@f4d/contracts';
import { Badge } from '@f4d/ui/components/badge';
import { Card } from '@f4d/ui/components/card';
import { useQuery } from '@tanstack/react-query';
import { ChatPanel } from '@/features/messaging/chat-panel';
import { Mediation } from './mediation';
import { dateTime, formatPriceRange } from '@/features/projects/format';
import { api } from '@/lib/api';

const brl = (cents: number) => formatPriceRange({ minCents: cents, maxCents: cents });

/** Contrato, pagamentos e o razão contábil (partidas dobradas) do projeto. */
export function ContractSection({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ['admin', 'projects', 'contract', projectId],
    queryFn: async () => {
      try {
        return await unwrap(
          api.GET('/v1/admin/projects/{projectId}/contract', { params: { path: { projectId } } }),
        );
      } catch (error) {
        if (error instanceof ApiError && error.problem.status === 404) return null;
        throw error;
      }
    },
  });
  const contract = query.data;
  if (!contract) return null;
  const { amounts } = contract;
  return (
    <>
      <Card tone="surface" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-h4 font-medium">Contrato</h2>
          <Badge tone="dark">{CONTRACT_STATUS_LABELS[contract.status]}</Badge>
          <span className="text-sm text-muted">
            {contract.client.displayName} → {contract.freelancer.displayName}
          </span>
        </div>
        <dl className="grid gap-3 text-body sm:grid-cols-4">
          <div>
            <dt className="text-sm text-muted">Proposta</dt>
            <dd>{brl(amounts.proposalCents)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">
              Comissão ({amounts.commissionBps / 100}% · paga por{' '}
              {
                { CLIENT: 'cliente', FREELANCER: 'freelancer', SPLIT: 'ambos' }[
                  amounts.commissionPayer
                ]
              }
              )
            </dt>
            <dd>{brl(amounts.platformFeeCents)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Cliente paga / dev recebe</dt>
            <dd>
              {brl(amounts.clientTotalCents)} / {brl(amounts.freelancerNetCents)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Em custódia (razão)</dt>
            <dd className="font-medium">{brl(contract.escrowBalanceCents)}</dd>
          </div>
        </dl>
        {contract.payments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-dark">
                  <th className="py-2 pr-4">Pagamento</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Valor</th>
                  <th className="py-2 pr-4">Devolvido</th>
                  <th className="py-2 pr-4">Criado</th>
                  <th className="py-2">Confirmado</th>
                </tr>
              </thead>
              <tbody>
                {contract.payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-dark/20">
                    <td className="py-2 pr-4">
                      {payment.provider} · {payment.providerCheckoutId.slice(0, 18)}…
                    </td>
                    <td className="py-2 pr-4">{payment.status}</td>
                    <td className="py-2 pr-4">
                      {brl(payment.amountCents)}
                      {payment.outOfScopeId ? ' (adicional)' : ''}
                    </td>
                    <td className="py-2 pr-4">
                      {payment.refundedCents > 0 ? brl(payment.refundedCents) : '—'}
                    </td>
                    <td className="py-2 pr-4">{dateTime.format(new Date(payment.createdAt))}</td>
                    <td className="py-2">
                      {payment.succeededAt ? dateTime.format(new Date(payment.succeededAt)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {contract.ledger.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-dark">
                  <th className="py-2 pr-4">Lançamento</th>
                  <th className="py-2 pr-4">Conta</th>
                  <th className="py-2 pr-4 text-right">Débito</th>
                  <th className="py-2 text-right">Crédito</th>
                </tr>
              </thead>
              <tbody>
                {contract.ledger.map((entry, index) => (
                  <tr key={`${entry.journalId}-${index}`} className="border-b border-dark/20">
                    <td className="py-2 pr-4">{entry.kind}</td>
                    <td className="py-2 pr-4">{entry.account}</td>
                    <td className="py-2 pr-4 text-right">
                      {entry.debitCents ? brl(entry.debitCents) : ''}
                    </td>
                    <td className="py-2 text-right">
                      {entry.creditCents ? brl(entry.creditCents) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
      <Mediation contract={contract} projectId={projectId} />
      {CONTRACT_CHAT_STATUSES.includes(contract.status) ? (
        <ChatPanel
          source={{ kind: 'contract', contractId: contract.id }}
          title="Conversa do contrato"
          description="Cliente e dev conversam aqui. Use para mediar; você aparece como Especialista."
        />
      ) : null}
    </>
  );
}
