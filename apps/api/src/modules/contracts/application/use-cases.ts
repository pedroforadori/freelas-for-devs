import type { RequestMeta } from '../../../shared/application/audit-log.js';
import { SYSTEM_REQUEST } from '../../../shared/application/audit-log.js';
import { HOUR_MS } from '../../../shared/kernel/clock.js';
import { computeAmounts } from '../domain/commission.js';
import { Contract } from '../domain/contract.js';
import { ContractNotFoundError, PaymentWindowClosedError } from '../domain/errors.js';
import { DeliveryRuleError } from '../domain/contract.js';
import {
  fundingJournal,
  LedgerAccount,
  payoutJournal,
  refundJournal,
  releaseJournal,
} from '../domain/ledger.js';
import { Payment } from '../domain/payment.js';
import {
  approvedEmail,
  deliveryReviewedEmail,
  deliverySubmittedEmail,
  lateRefundEmail,
  releasedEmail,
  paymentConfirmedClientEmail,
  paymentExpiredClientEmail,
  workStartsFreelancerEmail,
} from './emails.js';
import type { DeliveryInput, DeliveryReview, RatingInputValue } from './types.js';
import type { ContractsDeps, GatewayEvent } from './ports.js';

/** Checkouts do Stripe vivem no máximo 24 h; mínimo de 30 min. */
const CHECKOUT_MAX_MS = 23 * HOUR_MS;
const CHECKOUT_MIN_MS = 31 * 60_000;

type Mail = Parameters<ContractsDeps['mailer']['send']>[0];

abstract class ContractsUseCase {
  constructor(protected readonly deps: ContractsDeps) {}

  protected async participantContract(userId: string, contractId: string): Promise<Contract> {
    const contract = await this.deps.contracts.find(contractId);
    if (!contract?.isParticipant(userId)) throw new ContractNotFoundError();
    return contract;
  }

  protected async mail(userId: string, build: (to: string, name: string) => Mail): Promise<void> {
    const person = await this.deps.people.find(userId);
    if (person)
      await this.deps.mailer.send(build(person.email, person.displayName)).catch(() => undefined);
  }

  protected projectUrl(projectId: string): string {
    return `${this.deps.webAppUrl}/projetos/${projectId}`;
  }

  protected contractUrl(contractId: string): string {
    return `${this.deps.webAppUrl}/contratos/${contractId}`;
  }
}

/**
 * Proposta escolhida → contrato aguardando pagamento, com comissão e prazo copiados das
 * configurações vigentes (snapshot). Idempotente pela escolha (convite).
 */
export class CreateContractForSelection extends ContractsUseCase {
  execute(input: {
    projectId: string;
    invitationId: string;
    clientId: string;
    freelancerId: string;
    amountCents: number;
    deadlineDays: number;
  }): Promise<Contract> {
    return this.deps.uow.run(async () => {
      const existing = await this.deps.contracts.findByInvitation(input.invitationId);
      if (existing) return existing;
      const { settings, clock, ids } = this.deps;
      const now = clock.now();
      const contract = Contract.create({
        id: ids.next(),
        ...input,
        amounts: computeAmounts(
          input.amountCents,
          await settings.get('payments.commissionBps'),
          await settings.get('payments.commissionPayer'),
        ),
        paymentDeadlineAt: new Date(
          now.getTime() + (await settings.get('payments.paymentDeadlineHours')) * HOUR_MS,
        ),
        now,
      });
      await this.deps.contracts.save(contract);
      return contract;
    });
  }
}

/**
 * Cliente paga: reaproveita um checkout aberto ou cria outro no provedor (com chave de
 * idempotência). O checkout nunca vai além do prazo de pagamento do contrato.
 */
export class StartCheckout extends ContractsUseCase {
  async execute(clientId: string, contractId: string): Promise<string> {
    const { contracts, payments, gateway, clock, ids } = this.deps;
    const contract = await contracts.find(contractId);
    if (contract?.clientId !== clientId) throw new ContractNotFoundError();
    const now = clock.now();
    if (contract.status !== 'AWAITING_PAYMENT' || contract.paymentDeadlineAt <= now)
      throw new PaymentWindowClosedError();

    const reusable = (await payments.listByContract(contractId)).find((p) => p.isReusable(now));
    if (reusable) return reusable.checkoutUrl;

    const [project, client] = await Promise.all([
      this.deps.projects.find(contract.projectId),
      this.deps.people.find(clientId),
    ]);
    const paymentId = ids.next();
    const expiresAt = new Date(
      Math.max(
        now.getTime() + CHECKOUT_MIN_MS,
        Math.min(now.getTime() + CHECKOUT_MAX_MS, contract.paymentDeadlineAt.getTime()),
      ),
    );
    const returnUrl = this.projectUrl(contract.projectId);
    const session = await gateway.createCheckout(
      {
        paymentId,
        contractId,
        amountCents: contract.amounts.clientTotalCents,
        description: `Freelas 4 Devs — ${project?.title ?? 'Projeto'} (pagamento em custódia)`,
        customerEmail: client?.email ?? '',
        successUrl: `${returnUrl}?pagamento=confirmando`,
        cancelUrl: returnUrl,
        expiresAt,
      },
      `checkout:${paymentId}`,
    );
    await payments.save(
      Payment.start({
        id: paymentId,
        contractId,
        provider: gateway.provider,
        providerCheckoutId: session.providerCheckoutId,
        checkoutUrl: session.url,
        checkoutExpiresAt: session.expiresAt,
        amountCents: contract.amounts.clientTotalCents,
        createdAt: now,
      }),
    );
    return session.url;
  }
}

/**
 * Confirmação do pagamento (webhook ou reconciliador), idempotente:
 * - contrato aguardando → custódia (razão), projeto em andamento, avisos;
 * - contrato já encerrado (expirou/cancelou) ou valor divergente → devolve o dinheiro.
 */
export class ConfirmPayment extends ContractsUseCase {
  async execute(checkoutId: string, paymentRef: string | null, amountCents: number): Promise<void> {
    const { payments, contracts, ledger, clock, ids, gateway } = this.deps;
    const outcome = await this.deps.uow.run(async () => {
      const payment = await payments.findByCheckout(gateway.provider, checkoutId);
      // Já confirmado (ou devolvido): reentrega ou reconciliação repetida, nada a fazer.
      if (!payment || payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED') return null;
      const contract = await contracts.find(payment.contractId);
      if (!contract) return null;
      const now = clock.now();

      payment.succeed(paymentRef, now);
      await ledger.append(
        fundingJournal(
          { id: ids.next(), contractId: contract.id, reference: checkoutId, createdAt: now },
          amountCents,
        ),
      );
      const accepted =
        contract.status === 'AWAITING_PAYMENT' && amountCents === contract.amounts.clientTotalCents;
      if (accepted) {
        contract.fund(
          {
            reviewDays: await this.deps.settings.get('delivery.reviewDays'),
            autoApproveDays: await this.deps.settings.get('delivery.autoApproveDays'),
            maxCorrections: await this.deps.settings.get('delivery.finalCorrectionsMax'),
          },
          now,
        );
        await contracts.save(contract);
        await this.deps.projects.startWork(contract.projectId);
      } else {
        payment.refund(now);
        await ledger.append(
          refundJournal(
            { id: ids.next(), contractId: contract.id, reference: checkoutId, createdAt: now },
            amountCents,
          ),
        );
        await this.deps.audit.record({
          actorId: null,
          action: 'payments.late_payment_refunded',
          targetType: 'contract',
          targetId: contract.id,
          metadata: { checkoutId, amountCents, contractStatus: contract.status },
          request: SYSTEM_REQUEST,
        });
        // Dentro da transação: se o provedor falhar, nada é gravado e a confirmação é repetida
        // (webhook reenviado ou reconciliador). A chave de idempotência evita reembolso duplo.
        if (paymentRef) await gateway.refund(paymentRef, amountCents, `refund:${payment.id}`);
      }
      await payments.save(payment);
      return { contract, accepted };
    });
    if (!outcome) return;

    const { contract, accepted } = outcome;
    const url = this.projectUrl(contract.projectId);
    const title = (await this.deps.projects.find(contract.projectId))?.title ?? 'Projeto';
    if (accepted) {
      await this.mail(contract.clientId, (to, name) =>
        paymentConfirmedClientEmail(to, name, title, url),
      );
      await this.mail(contract.freelancerId, (to, name) =>
        workStartsFreelancerEmail(to, name, title, `${this.deps.webAppUrl}/convites`),
      );
      return;
    }
    await this.mail(contract.clientId, (to, name) => lateRefundEmail(to, name, title, url));
  }
}

/** Webhook do provedor: cada evento é processado uma única vez (caixa de entrada idempotente). */
export class HandlePaymentEvent extends ContractsUseCase {
  constructor(
    deps: ContractsDeps,
    private readonly confirm: ConfirmPayment,
    private readonly release?: ReleasePayment,
  ) {
    super(deps);
  }

  async execute(event: GatewayEvent): Promise<void> {
    const { gateway, inbox, clock } = this.deps;
    // Registro e processamento na mesma transação: se o processamento falhar, o evento não fica
    // marcado como recebido e a reentrega do provedor tenta de novo.
    await this.deps.uow.run(async () => {
      if (!(await inbox.recordOnce(gateway.provider, event.id, event.kind, clock.now()))) return;
      await this.process(event);
    });
  }

  private async process(event: GatewayEvent): Promise<void> {
    const { gateway, clock, payments, payoutAccounts } = this.deps;
    switch (event.kind) {
      case 'payment.succeeded':
        await this.confirm.execute(event.checkoutId, event.paymentRef, event.amountCents);
        break;
      case 'payment.failed':
      case 'payment.expired': {
        await this.deps.uow.run(async () => {
          const payment = await payments.findByCheckout(gateway.provider, event.checkoutId);
          if (payment?.status !== 'PENDING') return;
          if (event.kind === 'payment.failed') payment.fail(clock.now());
          else payment.expire(clock.now());
          await payments.save(payment);
        });
        break;
      }
      case 'account.updated': {
        const account = await payoutAccounts.findByProviderAccount(
          gateway.provider,
          event.accountId,
        );
        if (account) {
          await payoutAccounts.save(
            {
              ...account,
              detailsSubmitted: event.detailsSubmitted,
              payoutsEnabled: event.payoutsEnabled,
            },
            clock.now(),
          );
          // Conta ficou pronta: repasses que esperavam por ela saem agora.
          if (event.payoutsEnabled && this.release) {
            const pending = await this.deps.contracts.approvedUnreleased({
              freelancerId: account.userId,
              limit: 20,
            });
            for (const contractId of pending) await this.release.execute(contractId);
          }
        }
        break;
      }
      case 'ignored':
        break;
    }
  }
}

/** Reconciliador (a cada minuto): contratos não pagos no prazo expiram; checkouts são fechados. */
export class ExpireUnpaidContracts extends ContractsUseCase {
  async execute(batch = 50): Promise<number> {
    const { contracts, payments, gateway, clock } = this.deps;
    const ids = await contracts.awaitingPaymentPastDeadline(clock.now(), batch);
    for (const contractId of ids) {
      const closed = await this.deps.uow.run(async () => {
        const contract = await contracts.find(contractId);
        if (contract?.status !== 'AWAITING_PAYMENT') return null;
        const now = clock.now();
        contract.expire(now);
        await contracts.save(contract);
        const open = (await payments.listByContract(contractId)).filter(
          (p) => p.status === 'PENDING',
        );
        for (const payment of open) {
          payment.expire(now);
          await payments.save(payment);
        }
        return { contract, checkouts: open.map((p) => p.providerCheckoutId) };
      });
      if (!closed) continue;
      for (const checkoutId of closed.checkouts) await gateway.expireCheckout(checkoutId);
      const title = (await this.deps.projects.find(closed.contract.projectId))?.title ?? 'Projeto';
      await this.mail(closed.contract.clientId, (to, name) =>
        paymentExpiredClientEmail(to, name, title, this.projectUrl(closed.contract.projectId)),
      );
    }
    return ids.length;
  }
}

/**
 * Reconciliação com o provedor: pagamentos pendentes há mais de 15 min são consultados — cobre
 * webhook perdido (confirma) e checkout vencido sem aviso (expira).
 */
export class ReconcilePendingPayments extends ContractsUseCase {
  constructor(
    deps: ContractsDeps,
    private readonly confirm: ConfirmPayment,
  ) {
    super(deps);
  }

  async execute(batch = 50): Promise<{ confirmed: number; closed: number }> {
    const { payments, gateway, clock } = this.deps;
    const stale = await payments.pendingCreatedBefore(
      new Date(clock.now().getTime() - 15 * 60_000),
      batch,
    );
    let confirmed = 0;
    let closed = 0;
    for (const payment of stale) {
      const state = await gateway.retrieveCheckout(payment.providerCheckoutId);
      if (state.state === 'paid') {
        await this.confirm.execute(payment.providerCheckoutId, state.paymentRef, state.amountCents);
        confirmed += 1;
      } else if (state.state === 'expired' || state.state === 'failed') {
        await this.deps.uow.run(async () => {
          const fresh = await payments.findByCheckout(gateway.provider, payment.providerCheckoutId);
          if (fresh?.status !== 'PENDING') return;
          if (state.state === 'failed') fresh.fail(clock.now());
          else fresh.expire(clock.now());
          await payments.save(fresh);
        });
        closed += 1;
      }
    }
    return { confirmed, closed };
  }
}

/** Projeto cancelado antes do pagamento: o contrato é encerrado e os checkouts fechados. */
export class CancelContractForProject extends ContractsUseCase {
  async execute(projectId: string): Promise<void> {
    const { contracts, payments, gateway, clock } = this.deps;
    const checkouts = await this.deps.uow.run(async () => {
      const contract = await contracts.findLatestByProject(projectId);
      if (contract?.status !== 'AWAITING_PAYMENT') return [];
      const now = clock.now();
      contract.cancel(now);
      await contracts.save(contract);
      const open = (await payments.listByContract(contract.id)).filter(
        (p) => p.status === 'PENDING',
      );
      for (const payment of open) {
        payment.expire(now);
        await payments.save(payment);
      }
      return open.map((p) => p.providerCheckoutId);
    });
    for (const checkoutId of checkouts) await gateway.expireCheckout(checkoutId);
  }
}

/** Conta de recebimento do freelancer (Stripe Connect Express): onboarding no provedor. */
export class ManagePayoutAccount extends ContractsUseCase {
  async status(userId: string) {
    const account = await this.deps.payoutAccounts.find(userId);
    if (!account) return { exists: false, detailsSubmitted: false, payoutsEnabled: false };
    // Atualiza na leitura: o freelancer volta do onboarding antes de o webhook chegar.
    const fresh = await this.deps.gateway.retrieveAccount(account.providerAccountId);
    if (
      fresh.detailsSubmitted !== account.detailsSubmitted ||
      fresh.payoutsEnabled !== account.payoutsEnabled
    ) {
      await this.deps.payoutAccounts.save({ ...account, ...fresh }, this.deps.clock.now());
    }
    return { exists: true, ...fresh };
  }

  async onboardingUrl(userId: string, meta: RequestMeta): Promise<string> {
    const { payoutAccounts, gateway, clock, webAppUrl } = this.deps;
    let account = await payoutAccounts.find(userId);
    if (!account) {
      const person = await this.deps.people.find(userId);
      const providerAccountId = await gateway.createConnectedAccount({
        userId,
        email: person?.email ?? '',
      });
      account = {
        userId,
        provider: gateway.provider,
        providerAccountId,
        detailsSubmitted: false,
        payoutsEnabled: false,
      };
      await payoutAccounts.save(account, clock.now());
      await this.deps.audit.record({
        actorId: userId,
        action: 'payments.payout_account_created',
        targetType: 'payout_account',
        targetId: userId,
        request: meta,
      });
    }
    return gateway.createOnboardingLink(account.providerAccountId, {
      returnUrl: `${webAppUrl}/conta/recebimentos?retorno=1`,
      refreshUrl: `${webAppUrl}/conta/recebimentos?expirado=1`,
    });
  }
}

export class ReadContracts extends ContractsUseCase {
  get(userId: string, contractId: string): Promise<Contract> {
    return this.participantContract(userId, contractId);
  }

  async forProject(userId: string, projectId: string): Promise<Contract> {
    const contract = await this.deps.contracts.findLatestByProject(projectId);
    if (!contract?.isParticipant(userId)) throw new ContractNotFoundError();
    return contract;
  }

  async adminForProject(projectId: string) {
    const contract = await this.deps.contracts.findLatestByProject(projectId);
    if (!contract) throw new ContractNotFoundError();
    const [payments, ledger, escrow] = await Promise.all([
      this.deps.payments.listByContract(contract.id),
      this.deps.ledger.entries(contract.id),
      this.deps.ledger.balance(contract.id, LedgerAccount.Escrow),
    ]);
    return { contract, payments, ledger, escrowBalanceCents: escrow };
  }

  listForUser(userId: string): Promise<Contract[]> {
    return this.deps.contracts.listForUser(userId, 50);
  }

  rating(contractId: string) {
    return this.deps.ratings.find(contractId);
  }

  async hasOpenCheckout(contract: Contract): Promise<boolean> {
    const now = this.deps.clock.now();
    return (await this.deps.payments.listByContract(contract.id)).some((p) => p.isReusable(now));
  }
}

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date);

const brl = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

/** Freelancer entrega a etapa atual; arquivos passam a ser legíveis pelo cliente. */
export class SubmitDelivery extends ContractsUseCase {
  async execute(freelancerId: string, contractId: string, input: DeliveryInput): Promise<Contract> {
    const contract = await this.deps.uow.run(async () => {
      const loaded = await this.participantContract(freelancerId, contractId);
      const attachments = [...new Set(input.attachmentIds)];
      const usable = await this.deps.files.usableBy(freelancerId, attachments, 'DELIVERY_FILE');
      if (usable.length !== attachments.length)
        throw new DeliveryRuleError(
          'Um ou mais arquivos não existem, não são seus ou foram recusados.',
        );
      loaded.deliver(freelancerId, { ...input, attachmentIds: attachments }, this.deps.clock.now());
      await this.deps.contracts.save(loaded);
      await this.deps.files.grant(attachments, loaded.clientId, 'contract-delivery');
      return loaded;
    });
    const delivery = contract.currentDelivery!;
    const title = (await this.deps.projects.find(contract.projectId))?.title ?? 'Projeto';
    await this.mail(contract.clientId, (to, name) =>
      deliverySubmittedEmail(
        to,
        name,
        title,
        delivery.number,
        formatDate(delivery.reviewDeadlineAt),
        this.contractUrl(contract.id),
      ),
    );
    return contract;
  }
}

/** Revisão do cliente: aprovar (conclui o projeto), lista de ajustes ou correção pontual. */
export class ReviewDelivery extends ContractsUseCase {
  async execute(clientId: string, contractId: string, review: DeliveryReview): Promise<Contract> {
    const contract = await this.deps.uow.run(async () => {
      const loaded = await this.participantContract(clientId, contractId);
      const now = this.deps.clock.now();
      if (review.decision === 'APPROVE') {
        loaded.approve('CLIENT', clientId, now);
        await this.deps.contracts.save(loaded);
        await this.deps.projects.complete(loaded.projectId);
      } else if (review.decision === 'ADJUSTMENTS') {
        const items = review.items.map((text) => ({ id: this.deps.ids.next(), text }));
        loaded.requestAdjustments(clientId, items, now);
        await this.deps.contracts.save(loaded);
      } else {
        loaded.requestCorrection(clientId, review.adjustmentIds, review.note ?? null, now);
        await this.deps.contracts.save(loaded);
      }
      return loaded;
    });
    await this.notifyFreelancer(contract, review.decision);
    return contract;
  }

  private async notifyFreelancer(contract: Contract, decision: DeliveryReview['decision']) {
    const title = (await this.deps.projects.find(contract.projectId))?.title ?? 'Projeto';
    if (decision === 'APPROVE') {
      const account = await this.deps.payoutAccounts.find(contract.freelancerId);
      const needsAccount = !account?.payoutsEnabled;
      await this.mail(contract.freelancerId, (to, name) =>
        approvedEmail(
          to,
          name,
          title,
          false,
          needsAccount,
          needsAccount
            ? `${this.deps.webAppUrl}/conta/recebimentos`
            : this.contractUrl(contract.id),
        ),
      );
      return;
    }
    await this.mail(contract.freelancerId, (to, name) =>
      deliveryReviewedEmail(
        to,
        name,
        title,
        decision === 'ADJUSTMENTS' ? 'ADJUSTMENTS' : 'CORRECTION',
        this.contractUrl(contract.id),
      ),
    );
  }
}

/** Reconciliador (a cada minuto): revisões vencidas avançam; a final é aprovada automaticamente. */
export class ProcessReviewDeadlines extends ContractsUseCase {
  async execute(batch = 50): Promise<number> {
    const ids = await this.deps.contracts.reviewsPastDeadline(this.deps.clock.now(), batch);
    let processed = 0;
    for (const contractId of ids) {
      const outcome = await this.deps.uow.run(async () => {
        const contract = await this.deps.contracts.find(contractId);
        const result = contract?.reviewTimeout(this.deps.clock.now()) ?? null;
        if (!contract || !result) return null;
        await this.deps.contracts.save(contract);
        if (result === 'AUTO_APPROVED') await this.deps.projects.complete(contract.projectId);
        return { contract, result };
      });
      if (!outcome) continue;
      processed += 1;
      const { contract, result } = outcome;
      const title = (await this.deps.projects.find(contract.projectId))?.title ?? 'Projeto';
      if (result === 'AUTO_APPROVED') {
        const account = await this.deps.payoutAccounts.find(contract.freelancerId);
        await this.mail(contract.freelancerId, (to, name) =>
          approvedEmail(
            to,
            name,
            title,
            true,
            !account?.payoutsEnabled,
            this.contractUrl(contract.id),
          ),
        );
      } else {
        await this.mail(contract.freelancerId, (to, name) =>
          deliveryReviewedEmail(to, name, title, 'TIMEOUT', this.contractUrl(contract.id)),
        );
      }
    }
    return processed;
  }
}

export type ReleaseOutcome = 'RELEASED' | 'WAITING_ACCOUNT' | 'SKIPPED';

/**
 * Liberação (ContractApproved, nova tentativa periódica ou conta pronta): repassa o líquido ao
 * freelancer e lança RELEASE + PAYOUT no razão — tudo na mesma transação; a chamada ao provedor é
 * idempotente pela chave, então uma falha só adia o repasse.
 */
export class ReleasePayment extends ContractsUseCase {
  async execute(contractId: string): Promise<ReleaseOutcome> {
    const outcome = await this.deps.uow.run(async (): Promise<ReleaseOutcome> => {
      const contract = await this.deps.contracts.find(contractId);
      if (contract?.status !== 'APPROVED') return 'SKIPPED';
      let account = await this.deps.payoutAccounts.find(contract.freelancerId);
      if (!account) return 'WAITING_ACCOUNT';
      if (!account.payoutsEnabled) {
        // O aviso do provedor (account.updated) pode ter se perdido: confere direto nele.
        const fresh = await this.deps.gateway.retrieveAccount(account.providerAccountId);
        if (!fresh.payoutsEnabled) return 'WAITING_ACCOUNT';
        account = { ...account, ...fresh };
        await this.deps.payoutAccounts.save(account, this.deps.clock.now());
      }

      const { freelancerNetCents, platformFeeCents } = contract.amounts;
      const transferRef = await this.deps.gateway.createTransfer(
        {
          amountCents: freelancerNetCents,
          destinationAccountId: account.providerAccountId,
          contractId: contract.id,
        },
        `transfer:${contract.id}`,
      );
      const now = this.deps.clock.now();
      const base = { contractId: contract.id, reference: transferRef, createdAt: now };
      await this.deps.ledger.append(
        releaseJournal(
          { ...base, id: this.deps.ids.next() },
          { freelancerNetCents, platformFeeCents },
        ),
      );
      await this.deps.ledger.append(
        payoutJournal({ ...base, id: this.deps.ids.next() }, freelancerNetCents),
      );
      contract.release(transferRef, now);
      await this.deps.contracts.save(contract);
      return 'RELEASED';
    });
    if (outcome === 'RELEASED') {
      const contract = (await this.deps.contracts.find(contractId))!;
      const title = (await this.deps.projects.find(contract.projectId))?.title ?? 'Projeto';
      await this.mail(contract.freelancerId, (to, name) =>
        releasedEmail(
          to,
          name,
          title,
          brl(contract.amounts.freelancerNetCents),
          this.contractUrl(contractId),
        ),
      );
    }
    return outcome;
  }
}

/** Nova tentativa periódica dos repasses pendentes (conta pronta, saldo disponível, provedor fora). */
export class RetryPendingReleases extends ContractsUseCase {
  constructor(
    deps: ContractsDeps,
    private readonly release: ReleasePayment,
  ) {
    super(deps);
  }

  async execute(): Promise<number> {
    let released = 0;
    for (const contractId of await this.deps.contracts.approvedUnreleased({ limit: 50 })) {
      try {
        if ((await this.release.execute(contractId)) === 'RELEASED') released += 1;
      } catch {
        // Fica para a próxima rodada (ex.: saldo ainda não disponível no provedor).
      }
    }
    return released;
  }
}

/** Avaliação do cliente depois da aprovação (uma por contrato); base da reputação (F9). */
export class RateFreelancer extends ContractsUseCase {
  async execute(clientId: string, contractId: string, input: RatingInputValue): Promise<Contract> {
    const contract = await this.participantContract(clientId, contractId);
    if (contract.clientId !== clientId) throw new ContractNotFoundError();
    if (contract.status !== 'APPROVED' && contract.status !== 'RELEASED')
      throw new DeliveryRuleError(
        'A avaliação fica disponível depois da aprovação da entrega final.',
      );
    const created = await this.deps.ratings.create({
      contractId,
      freelancerId: contract.freelancerId,
      clientId,
      rating: input.rating,
      comment: input.comment?.trim() || null,
      createdAt: this.deps.clock.now(),
    });
    if (!created) throw new DeliveryRuleError('Este contrato já foi avaliado.');
    return contract;
  }
}
