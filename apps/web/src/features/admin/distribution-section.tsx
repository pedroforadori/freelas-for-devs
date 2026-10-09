'use client';

import { unwrap } from '@f4d/api-client';
import { INVITATION_STATUS_LABELS, SELECTION_FEEDBACK_LABELS } from '@f4d/contracts';
import { Card } from '@f4d/ui/components/card';
import { useQuery } from '@tanstack/react-query';
import { dateTime, formatPriceRange } from '@/features/projects/format';
import { api } from '@/lib/api';

const ROUND_STATUS = {
  OPEN: 'aberta',
  SELECTED: 'com proposta escolhida',
  EXHAUSTED: 'esgotada',
  CLOSED: 'encerrada',
  CANCELLED: 'cancelada',
} as const;

/** Rodada de distribuição do projeto: quem foi convidado, quando, e o que respondeu. */
export function DistributionSection({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ['admin', 'projects', 'distribution', projectId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/admin/projects/{projectId}/distribution', {
          params: { path: { projectId } },
        }),
      ),
  });
  const data = query.data;
  if (!data?.round) return null;
  const { round } = data;
  return (
    <Card tone="surface" className="flex flex-col gap-4">
      <h2 className="text-h4 font-medium">Distribuição</h2>
      <p className="text-sm text-muted">
        Rodada {ROUND_STATUS[round.status]} · nível {round.levelSlug} · K = {round.roundSize} · teto{' '}
        {round.maxInvites} convites · {round.inviteResponseHours} h para responder · aberta em{' '}
        {dateTime.format(new Date(round.openedAt))}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-dark">
              <th className="py-2 pr-4">Freelancer</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Convidado</th>
              <th className="py-2 pr-4">Prazo</th>
              <th className="py-2 pr-4">Proposta</th>
              <th className="py-2">Feedback do cliente</th>
            </tr>
          </thead>
          <tbody>
            {data.invitations.map((invitation) => (
              <tr key={invitation.id} className="border-b border-dark/20">
                <td className="py-2 pr-4">{invitation.freelancer.displayName}</td>
                <td className="py-2 pr-4">{INVITATION_STATUS_LABELS[invitation.status]}</td>
                <td className="py-2 pr-4">{dateTime.format(new Date(invitation.invitedAt))}</td>
                <td className="py-2 pr-4">{dateTime.format(new Date(invitation.deadlineAt))}</td>
                <td className="py-2 pr-4">
                  {invitation.amountCents !== null
                    ? `${formatPriceRange({ minCents: invitation.amountCents, maxCents: invitation.amountCents })} · ${invitation.deadlineDays} dias`
                    : '—'}
                </td>
                <td className="py-2">
                  {invitation.feedback
                    ?.map((reason) => SELECTION_FEEDBACK_LABELS[reason])
                    .join(', ') ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
