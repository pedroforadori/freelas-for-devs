import type { CommissionPayer } from '@f4d/contracts';
import { Money } from '../../../shared/kernel/money.js';

export interface ContractAmounts {
  proposalCents: number;
  platformFeeCents: number;
  commissionBps: number;
  commissionPayer: CommissionPayer;
  clientTotalCents: number;
  freelancerNetCents: number;
}

/**
 * Comissão da plataforma sobre o valor da proposta (ADR-0012), conforme quem paga:
 * - CLIENT: somada ao que o cliente paga; o freelancer recebe a proposta inteira.
 * - FREELANCER: descontada do que o freelancer recebe; o cliente paga a proposta.
 * - SPLIT: metade de cada lado (o centavo ímpar fica com o cliente).
 * Sempre vale: cliente paga = freelancer recebe + comissão (nada se perde no arredondamento).
 */
export const computeAmounts = (
  proposalCents: number,
  commissionBps: number,
  commissionPayer: CommissionPayer,
): ContractAmounts => {
  const proposal = Money.ofCents(proposalCents);
  const fee = proposal.percentage(commissionBps);
  const [clientShare, freelancerShare] =
    commissionPayer === 'CLIENT'
      ? [fee, Money.zero()]
      : commissionPayer === 'FREELANCER'
        ? [Money.zero(), fee]
        : (fee.allocate([1, 1]) as [Money, Money]);
  return {
    proposalCents,
    platformFeeCents: fee.cents,
    commissionBps,
    commissionPayer,
    clientTotalCents: proposal.add(clientShare).cents,
    freelancerNetCents: proposal.subtract(freelancerShare).cents,
  };
};
