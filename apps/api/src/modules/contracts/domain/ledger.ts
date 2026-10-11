import { DomainError } from '../../../shared/kernel/domain-error.js';

export const LedgerAccount = {
  /** Dinheiro recebido do cliente, no saldo da plataforma no provedor. */
  GatewayClearing: 'GATEWAY_CLEARING',
  /** Custódia: devido ao freelancer/plataforma até a aprovação final (ou ao cliente, no reembolso). */
  Escrow: 'ESCROW',
  FreelancerPayable: 'FREELANCER_PAYABLE',
  PlatformRevenue: 'PLATFORM_REVENUE',
} as const;
export type LedgerAccount = (typeof LedgerAccount)[keyof typeof LedgerAccount];

export type JournalKind = 'FUNDING' | 'REFUND' | 'RELEASE' | 'PAYOUT';

export interface JournalLine {
  account: LedgerAccount;
  debitCents: number;
  creditCents: number;
}

export interface Journal {
  id: string;
  contractId: string;
  kind: JournalKind;
  reference: string | null;
  lines: JournalLine[];
  createdAt: Date;
}

export class UnbalancedJournalError extends DomainError {
  readonly code = 'INTERNAL_ERROR';
  constructor(debits: number, credits: number) {
    super(`Lançamento desbalanceado: débitos ${debits} ≠ créditos ${credits}.`);
  }
}

/** Partidas dobradas: um lançamento só existe se débitos = créditos e todos os valores > 0. */
const journal = (input: Omit<Journal, 'lines'>, lines: JournalLine[]): Journal => {
  const debits = lines.reduce((sum, line) => sum + line.debitCents, 0);
  const credits = lines.reduce((sum, line) => sum + line.creditCents, 0);
  const valid = lines.every(
    (line) =>
      Number.isSafeInteger(line.debitCents) &&
      Number.isSafeInteger(line.creditCents) &&
      line.debitCents >= 0 &&
      line.creditCents >= 0 &&
      line.debitCents > 0 !== line.creditCents > 0,
  );
  if (!valid || debits !== credits || debits === 0)
    throw new UnbalancedJournalError(debits, credits);
  return { ...input, lines };
};

/** Pagamento confirmado: o valor pago pelo cliente entra em custódia. */
export const fundingJournal = (input: Omit<Journal, 'lines' | 'kind'>, clientTotalCents: number) =>
  journal({ ...input, kind: 'FUNDING' }, [
    { account: LedgerAccount.GatewayClearing, debitCents: clientTotalCents, creditCents: 0 },
    { account: LedgerAccount.Escrow, debitCents: 0, creditCents: clientTotalCents },
  ]);

/** Devolução ao cliente: a custódia é baixada. */
export const refundJournal = (input: Omit<Journal, 'lines' | 'kind'>, amountCents: number) =>
  journal({ ...input, kind: 'REFUND' }, [
    { account: LedgerAccount.Escrow, debitCents: amountCents, creditCents: 0 },
    { account: LedgerAccount.GatewayClearing, debitCents: 0, creditCents: amountCents },
  ]);

/** Liberação (F7): a custódia vira repasse ao freelancer e receita da plataforma. */
export const releaseJournal = (
  input: Omit<Journal, 'lines' | 'kind'>,
  amounts: { freelancerNetCents: number; platformFeeCents: number },
) =>
  journal({ ...input, kind: 'RELEASE' }, [
    {
      account: LedgerAccount.Escrow,
      debitCents: amounts.freelancerNetCents + amounts.platformFeeCents,
      creditCents: 0,
    },
    {
      account: LedgerAccount.FreelancerPayable,
      debitCents: 0,
      creditCents: amounts.freelancerNetCents,
    },
    ...(amounts.platformFeeCents > 0
      ? [
          {
            account: LedgerAccount.PlatformRevenue,
            debitCents: 0,
            creditCents: amounts.platformFeeCents,
          },
        ]
      : []),
  ]);

/** Transferência ao freelancer concluída: o valor devido sai do saldo da plataforma. */
export const payoutJournal = (input: Omit<Journal, 'lines' | 'kind'>, amountCents: number) =>
  journal({ ...input, kind: 'PAYOUT' }, [
    { account: LedgerAccount.FreelancerPayable, debitCents: amountCents, creditCents: 0 },
    { account: LedgerAccount.GatewayClearing, debitCents: 0, creditCents: amountCents },
  ]);
