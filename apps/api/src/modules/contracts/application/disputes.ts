import type { OpenDisputeInput, OutOfScopeInput, ResolveDisputeInput } from '@f4d/contracts';
import { OUT_OF_SCOPE_LIMITS } from '@f4d/contracts';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import { DAY_MS, HOUR_MS } from '../../../shared/kernel/clock.js';
import { computeAmounts } from '../domain/commission.js';
import { type Contract, DeliveryRuleError } from '../domain/contract.js';
import { Dispute, type DisputeParty } from '../domain/dispute.js';
import { ContractNotFoundError } from '../domain/errors.js';
import { LedgerAccount, payoutJournal, refundJournal, releaseJournal } from '../domain/ledger.js';
import { OutOfScopeRequest } from '../domain/out-of-scope.js';
import { Payment } from '../domain/payment.js';
import {
  disputeOpenedEmail,
  disputeResolvedEmail,
  disputeWithdrawnEmail,
  outOfScopeAnsweredEmail,
  outOfScopeFlaggedEmail,
  outOfScopeRuledEmail,
} from './emails.js';
import type { ContractsDeps } from './ports.js';
import { ContractsUseCase } from './use-cases.js';

const brl = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date);

/** Checkouts do provedor: no máximo 23 h e ao menos 31 min (mesma regra do contrato). */
const checkoutExpiry = (now: Date, deadline: Date) =>
  new Date(
    Math.max(
      now.getTime() + 31 * 60_000,
      Math.min(now.getTime() + 23 * HOUR_MS, deadline.getTime()),
    ),
  );

const roleOf = (contract: Contract, userId: string): DisputeParty => {
  if (userId === contract.clientId) return 'CLIENT';
  if (userId === contract.freelancerId) return 'FREELANCER';
  throw new ContractNotFoundError();
};

/**
 * Pedidos fora do escopo (docs/architecture.md §4.4): o freelancer marca e propõe o adicional;
 * o cliente aceita (paga à parte), retira ou contesta; a mediação decide as contestações.
 * Enquanto pendente, os prazos do contrato ficam pausados.
 */
export class ManageOutOfScope extends ContractsUseCase {
  async flag(freelancerId: string, contractId: string, input: OutOfScopeInput): Promise<Contract> {
    const { contract, request } = await this.deps.uow.run(async () => {
      const contract = await this.deps.contracts.find(contractId);
      if (contract?.freelancerId !== freelancerId) throw new ContractNotFoundError();
      if (contract.status !== 'ACTIVE')
        throw new DeliveryRuleError('Só é possível marcar pedidos com o contrato em andamento.');
      const pending = (await this.deps.outOfScope.listByContract(contractId)).filter(
        (item) => item.pending,
      );
      if (pending.length >= OUT_OF_SCOPE_LIMITS.pendingMax)
        throw new DeliveryRuleError(
          `Há ${pending.length} pedidos fora de escopo aguardando resposta. Espere o cliente responder.`,
        );
      const now = this.deps.clock.now();
      const { commissionBps, commissionPayer } = contract.amounts;
      const request = OutOfScopeRequest.flag({
        id: this.deps.ids.next(),
        contractId,
        projectId: contract.projectId,
        description: input.description,
        amounts: computeAmounts(input.amountCents, commissionBps, commissionPayer),
        extraDays: input.extraDays,
        now,
      });
      contract.hold(request.holdKey, now);
      await this.deps.outOfScope.save(request);
      await this.deps.contracts.save(contract);
      return { contract, request };
    });
    const title = await this.projectTitle(contract.projectId);
    await this.mail(contract.clientId, (to, name) =>
      outOfScopeFlaggedEmail(
        to,
        name,
        title,
        brl(request.amounts.clientTotalCents),
        this.contractUrl(contract.id),
      ),
    );
    return contract;
  }

  async accept(clientId: string, contractId: string, requestId: string): Promise<Contract> {
    const contract = await this.change(
      clientId,
      contractId,
      requestId,
      'CLIENT',
      async (c, r, now) => {
        if (c.status !== 'ACTIVE') throw new DeliveryRuleError('O contrato não está em andamento.');
        const hours = await this.deps.settings.get('payments.paymentDeadlineHours');
        r.accept(new Date(now.getTime() + hours * HOUR_MS), now);
      },
    );
    await this.notifyFreelancer(contract, 'ACCEPTED');
    return contract;
  }

  /** Cliente retira o pedido, ou o freelancer desiste de cobrar (faz sem custo ou não faz). */
  async withdraw(userId: string, contractId: string, requestId: string): Promise<Contract> {
    const role = { value: 'CLIENT' as DisputeParty };
    const contract = await this.change(userId, contractId, requestId, null, (c, r, now) => {
      role.value = roleOf(c, userId);
      r.withdraw(now);
      c.releaseHold(r.holdKey, now);
      return Promise.resolve();
    });
    await this.expireOpenCheckouts(requestId);
    if (role.value === 'CLIENT') await this.notifyFreelancer(contract, 'WITHDRAWN');
    return contract;
  }

  async contest(
    clientId: string,
    contractId: string,
    requestId: string,
    reason: string,
  ): Promise<Contract> {
    const contract = await this.change(clientId, contractId, requestId, 'CLIENT', (_c, r, now) => {
      r.contest(reason, now);
      return Promise.resolve();
    });
    await this.notifyFreelancer(contract, 'CONTESTED');
    return contract;
  }

  /** Checkout do adicional aceito (reaproveita um aberto). */
  async checkout(clientId: string, contractId: string, requestId: string): Promise<string> {
    const { contract, request } = await this.load(clientId, contractId, requestId, 'CLIENT');
    const now = this.deps.clock.now();
    const deadline = request.paymentDeadlineAt;
    if (request.status !== 'ACCEPTED_AWAITING_PAYMENT' || !deadline || deadline <= now)
      throw new DeliveryRuleError('Este adicional não está aguardando pagamento.');
    const reusable = (await this.deps.payments.listByContract(contractId)).find(
      (payment) => payment.outOfScopeId === requestId && payment.isReusable(now),
    );
    if (reusable) return reusable.checkoutUrl;

    const client = await this.deps.people.find(clientId);
    const title = await this.projectTitle(contract.projectId);
    const paymentId = this.deps.ids.next();
    const url = this.contractUrl(contractId);
    const session = await this.deps.gateway.createCheckout(
      {
        paymentId,
        contractId,
        amountCents: request.amounts.clientTotalCents,
        description: `Freelas 4 Devs — ${title} (adicional fora de escopo, em custódia)`,
        customerEmail: client?.email ?? '',
        successUrl: `${url}?pagamento=confirmando`,
        cancelUrl: url,
        expiresAt: checkoutExpiry(now, deadline),
      },
      `checkout:${paymentId}`,
    );
    await this.deps.payments.save(
      Payment.start({
        id: paymentId,
        contractId,
        outOfScopeId: requestId,
        provider: this.deps.gateway.provider,
        providerCheckoutId: session.providerCheckoutId,
        checkoutUrl: session.url,
        checkoutExpiresAt: session.expiresAt,
        amountCents: request.amounts.clientTotalCents,
        createdAt: now,
      }),
    );
    return session.url;
  }

  /** Mediação de um pedido contestado: dentro (sem custo) ou fora do escopo (cliente decide). */
  async rule(
    adminId: string,
    contractId: string,
    requestId: string,
    ruling: { decision: 'IN_SCOPE' | 'OUT_OF_SCOPE'; note: string },
    meta: RequestMeta,
  ): Promise<void> {
    const contract = await this.deps.uow.run(async () => {
      const contract = await this.deps.contracts.find(contractId);
      const request = await this.deps.outOfScope.find(requestId);
      if (!contract || request?.contractId !== contractId) throw new ContractNotFoundError();
      const now = this.deps.clock.now();
      request.rule({ ...ruling, adminId }, now);
      if (ruling.decision === 'IN_SCOPE') contract.releaseHold(request.holdKey, now);
      await this.deps.outOfScope.save(request);
      await this.deps.contracts.save(contract);
      await this.deps.audit.record({
        actorId: adminId,
        action: 'admin.out_of_scope_ruled',
        targetType: 'out_of_scope_request',
        targetId: requestId,
        metadata: { contractId, decision: ruling.decision },
        request: meta,
      });
      return contract;
    });
    const title = await this.projectTitle(contract.projectId);
    for (const userId of [contract.clientId, contract.freelancerId])
      await this.mail(userId, (to, name) =>
        outOfScopeRuledEmail(
          to,
          name,
          title,
          ruling.decision,
          ruling.note,
          this.contractUrl(contract.id),
        ),
      );
  }

  private async load(
    userId: string,
    contractId: string,
    requestId: string,
    role: DisputeParty | null,
  ) {
    const contract = await this.deps.contracts.find(contractId);
    const request = await this.deps.outOfScope.find(requestId);
    if (!contract?.isParticipant(userId) || request?.contractId !== contractId)
      throw new ContractNotFoundError();
    if (role && roleOf(contract, userId) !== role)
      throw new DeliveryRuleError(
        role === 'CLIENT' ? 'Só o cliente pode responder a este pedido.' : 'Ação do dev.',
      );
    return { contract, request };
  }

  private change(
    userId: string,
    contractId: string,
    requestId: string,
    role: DisputeParty | null,
    apply: (contract: Contract, request: OutOfScopeRequest, now: Date) => Promise<void>,
  ): Promise<Contract> {
    return this.deps.uow.run(async () => {
      const { contract, request } = await this.load(userId, contractId, requestId, role);
      await apply(contract, request, this.deps.clock.now());
      await this.deps.outOfScope.save(request);
      await this.deps.contracts.save(contract);
      return contract;
    });
  }

  private async notifyFreelancer(
    contract: Contract,
    answer: 'ACCEPTED' | 'WITHDRAWN' | 'CONTESTED',
  ): Promise<void> {
    const title = await this.projectTitle(contract.projectId);
    await this.mail(contract.freelancerId, (to, name) =>
      outOfScopeAnsweredEmail(to, name, title, answer, this.contractUrl(contract.id)),
    );
  }

  private async expireOpenCheckouts(requestId: string): Promise<void> {
    const request = await this.deps.outOfScope.find(requestId);
    if (!request) return;
    const open = await this.deps.uow.run(async () => {
      const pending = (await this.deps.payments.listByContract(request.contractId)).filter(
        (payment) => payment.outOfScopeId === requestId && payment.status === 'PENDING',
      );
      for (const payment of pending) {
        payment.expire(this.deps.clock.now());
        await this.deps.payments.save(payment);
      }
      return pending.map((payment) => payment.providerCheckoutId);
    });
    for (const checkoutId of open) await this.deps.gateway.expireCheckout(checkoutId);
  }
}

/** Reconciliador: adicional aceito e não pago no prazo volta a não existir (prazos retomam). */
export class ExpireUnpaidExtras extends ContractsUseCase {
  async execute(batch = 50): Promise<number> {
    const now = this.deps.clock.now();
    const ids = await this.deps.outOfScope.awaitingPaymentPastDeadline(now, batch);
    for (const requestId of ids) {
      const checkouts = await this.deps.uow.run(async () => {
        const request = await this.deps.outOfScope.find(requestId);
        if (request?.status !== 'ACCEPTED_AWAITING_PAYMENT') return [];
        const contract = await this.deps.contracts.find(request.contractId);
        if (!contract) return [];
        request.expirePayment(now);
        contract.releaseHold(request.holdKey, now);
        await this.deps.outOfScope.save(request);
        await this.deps.contracts.save(contract);
        const pending = (await this.deps.payments.listByContract(contract.id)).filter(
          (payment) => payment.outOfScopeId === requestId && payment.status === 'PENDING',
        );
        for (const payment of pending) {
          payment.expire(now);
          await this.deps.payments.save(payment);
        }
        return pending.map((payment) => payment.providerCheckoutId);
      });
      for (const checkoutId of checkouts) await this.deps.gateway.expireCheckout(checkoutId);
    }
    return ids.length;
  }
}

/**
 * Disputas e abandono (docs/architecture.md §4.5): a abertura congela o contrato e pausa os
 * prazos; as partes mandam sua versão até o prazo; a mediação decide quanto vai ao freelancer.
 */
export class ManageDispute extends ContractsUseCase {
  async open(userId: string, contractId: string, input: OpenDisputeInput): Promise<Contract> {
    const contract = await this.deps.contracts.find(contractId);
    if (!contract?.isParticipant(userId)) throw new ContractNotFoundError();
    const role = roleOf(contract, userId);
    return this.start(contractId, {
      kind: 'DISPUTE',
      openedBy: role,
      openerId: userId,
      reason: input.reason,
      description: input.description,
    });
  }

  /** O próprio freelancer desiste: abre a disputa de abandono (sem volta) e é penalizado na fila. */
  async abandon(freelancerId: string, contractId: string, description: string): Promise<Contract> {
    const contract = await this.deps.contracts.find(contractId);
    if (contract?.freelancerId !== freelancerId) throw new ContractNotFoundError();
    return this.start(contractId, {
      kind: 'ABANDONMENT',
      openedBy: 'FREELANCER',
      openerId: freelancerId,
      reason: 'ABANDONMENT',
      description,
    });
  }

  /** Freelancer sumiu: a mediação declara o abandono (mesmo efeito, auditado). */
  async declareAbandonment(
    adminId: string,
    contractId: string,
    description: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.start(contractId, {
      kind: 'ABANDONMENT',
      openedBy: 'ADMIN',
      openerId: adminId,
      reason: 'ABANDONMENT',
      description,
    });
    await this.deps.audit.record({
      actorId: adminId,
      action: 'admin.abandonment_declared',
      targetType: 'contract',
      targetId: contractId,
      request: meta,
    });
  }

  async addStatement(
    userId: string,
    contractId: string,
    input: { text: string; attachmentIds: string[] },
  ): Promise<Contract> {
    return this.deps.uow.run(async () => {
      const contract = await this.deps.contracts.find(contractId);
      if (!contract?.isParticipant(userId)) throw new ContractNotFoundError();
      const dispute = await this.deps.disputes.findActiveByContract(contractId);
      if (!dispute) throw new DeliveryRuleError('Não há disputa aberta neste contrato.');
      const role = roleOf(contract, userId);
      const attachments = [...new Set(input.attachmentIds)];
      const usable = await this.deps.files.usableBy(userId, attachments, 'DELIVERY_FILE');
      if (usable.length !== attachments.length)
        throw new DeliveryRuleError(
          'Um ou mais arquivos não existem, não são seus ou foram recusados.',
        );
      dispute.addStatement(
        { role, userId, text: input.text, attachmentIds: attachments },
        this.deps.clock.now(),
      );
      await this.deps.disputes.save(dispute);
      const other = role === 'CLIENT' ? contract.freelancerId : contract.clientId;
      await this.deps.files.grant(attachments, other, 'dispute-statement');
      return contract;
    });
  }

  async withdraw(userId: string, contractId: string): Promise<Contract> {
    const contract = await this.deps.uow.run(async () => {
      const contract = await this.deps.contracts.find(contractId);
      if (!contract?.isParticipant(userId)) throw new ContractNotFoundError();
      const dispute = await this.deps.disputes.findActiveByContract(contractId);
      if (!dispute) throw new DeliveryRuleError('Não há disputa aberta neste contrato.');
      const now = this.deps.clock.now();
      dispute.withdraw(userId, now);
      contract.resumeAfterDispute(dispute.id, now);
      await this.deps.disputes.save(dispute);
      await this.deps.contracts.save(contract);
      return contract;
    });
    const title = await this.projectTitle(contract.projectId);
    const other = userId === contract.clientId ? contract.freelancerId : contract.clientId;
    await this.mail(other, (to, name) =>
      disputeWithdrawnEmail(to, name, title, this.contractUrl(contract.id)),
    );
    return contract;
  }

  /**
   * Decisão: parte do valor ao freelancer, o restante devolvido ao cliente. Pedidos fora de
   * escopo pendentes são encerrados. A execução (repasse e reembolso) segue no worker.
   */
  async resolve(
    adminId: string,
    disputeId: string,
    input: ResolveDisputeInput,
    meta: RequestMeta,
  ): Promise<void> {
    const { contract, dispute, checkouts } = await this.deps.uow.run(async () => {
      const dispute = await this.deps.disputes.find(disputeId);
      if (!dispute) throw new DeliveryRuleError('Disputa não encontrada.');
      const contract = await this.deps.contracts.find(dispute.contractId);
      if (!contract) throw new ContractNotFoundError();
      const now = this.deps.clock.now();
      const resolution = dispute.resolve(
        {
          adminId,
          freelancerShareBps: input.freelancerShareBps,
          note: input.note,
          amounts: contract.amounts,
        },
        now,
      );
      // O razão precisa ter exatamente o que será dividido (nada a mais, nada a menos).
      const escrow = await this.deps.ledger.balance(contract.id, LedgerAccount.Escrow);
      const total =
        resolution.freelancerCents + resolution.platformFeeCents + resolution.refundCents;
      if (escrow !== total)
        throw new Error(`Custódia (${escrow}) diferente do valor a dividir (${total}).`);

      const checkouts: string[] = [];
      for (const request of await this.deps.outOfScope.listByContract(contract.id)) {
        if (!request.pending) continue;
        request.close(now);
        await this.deps.outOfScope.save(request);
      }
      for (const payment of await this.deps.payments.listByContract(contract.id)) {
        if (payment.status !== 'PENDING') continue;
        payment.expire(now);
        await this.deps.payments.save(payment);
        checkouts.push(payment.providerCheckoutId);
      }
      await this.deps.disputes.save(dispute);
      await this.deps.audit.record({
        actorId: adminId,
        action: 'admin.dispute_resolved',
        targetType: 'dispute',
        targetId: disputeId,
        metadata: { contractId: contract.id, ...resolution, decidedAt: undefined },
        request: meta,
      });
      return { contract, dispute, checkouts };
    });
    for (const checkoutId of checkouts) await this.deps.gateway.expireCheckout(checkoutId);

    const r = dispute.resolution!;
    const title = await this.projectTitle(contract.projectId);
    const url = this.contractUrl(contract.id);
    await this.mail(contract.clientId, (to, name) =>
      disputeResolvedEmail(
        to,
        name,
        title,
        r.refundCents > 0
          ? `Você recebe de volta ${brl(r.refundCents)}, estornados no mesmo meio de pagamento.`
          : 'O valor em custódia foi reconhecido integralmente ao dev.',
        r.note,
        url,
      ),
    );
    await this.mail(contract.freelancerId, (to, name) =>
      disputeResolvedEmail(
        to,
        name,
        title,
        r.freelancerCents > 0
          ? `Você recebe ${brl(r.freelancerCents)} pelo trabalho realizado (repasse para a sua conta de recebimento).`
          : 'O valor em custódia foi devolvido ao cliente.',
        r.note,
        url,
      ),
    );
  }

  private async start(
    contractId: string,
    input: {
      kind: 'DISPUTE' | 'ABANDONMENT';
      openedBy: DisputeParty | 'ADMIN';
      openerId: string;
      reason: OpenDisputeInput['reason'] | 'ABANDONMENT';
      description: string;
    },
  ): Promise<Contract> {
    const { contract, dispute } = await this.deps.uow.run(async () => {
      const contract = await this.deps.contracts.find(contractId);
      if (!contract) throw new ContractNotFoundError();
      if (contract.status !== 'ACTIVE')
        throw new DeliveryRuleError(
          contract.status === 'DISPUTED'
            ? 'Já existe uma disputa aberta neste contrato.'
            : 'Só é possível abrir disputa com o contrato em andamento.',
        );
      const now = this.deps.clock.now();
      const days = await this.deps.settings.get('dispute.evidenceDays');
      const dispute = Dispute.open({
        id: this.deps.ids.next(),
        contractId,
        projectId: contract.projectId,
        ...input,
        evidenceDeadlineAt: new Date(now.getTime() + days * DAY_MS),
        now,
      });
      contract.openDispute(dispute.id, input.kind, now);
      await this.deps.disputes.save(dispute);
      await this.deps.contracts.save(contract);
      return { contract, dispute };
    });
    const title = await this.projectTitle(contract.projectId);
    const deadline = formatDate(dispute.toSnapshot().evidenceDeadlineAt);
    const notify =
      input.openedBy === 'CLIENT'
        ? [contract.freelancerId]
        : input.openedBy === 'FREELANCER'
          ? [contract.clientId]
          : [contract.clientId, contract.freelancerId];
    for (const userId of notify)
      await this.mail(userId, (to, name) =>
        disputeOpenedEmail(to, name, title, input.kind, deadline, this.contractUrl(contract.id)),
      );
    return contract;
  }
}

/** Reconciliador: disputas com o prazo de manifestação vencido vão para a análise. */
export class AdvanceDisputes extends ContractsUseCase {
  async execute(batch = 50): Promise<number> {
    const now = this.deps.clock.now();
    let advanced = 0;
    for (const disputeId of await this.deps.disputes.openPastEvidenceDeadline(now, batch)) {
      await this.deps.uow.run(async () => {
        const dispute = await this.deps.disputes.find(disputeId);
        if (!dispute?.startReviewIfReady(now)) return;
        await this.deps.disputes.save(dispute);
        advanced += 1;
      });
    }
    return advanced;
  }
}

export type SettlementOutcome = 'CLOSED' | 'WAITING_ACCOUNT' | 'SKIPPED';

/**
 * Executa a decisão (DisputeResolved, nova tentativa periódica ou conta pronta): reembolso ao
 * cliente, repasse ao freelancer e lançamentos no razão. Cada passo roda uma vez — as chamadas
 * ao provedor têm chave de idempotência e o passo só é marcado feito na mesma transação.
 */
export class ExecuteSettlement extends ContractsUseCase {
  async execute(disputeId: string): Promise<SettlementOutcome> {
    if (!(await this.refund(disputeId))) return 'SKIPPED';
    if (!(await this.transfer(disputeId))) return 'WAITING_ACCOUNT';
    const closed = await this.deps.uow.run(async () => {
      const dispute = await this.deps.disputes.find(disputeId);
      if (dispute?.status !== 'EXECUTING' || !dispute.executed) return null;
      const contract = await this.deps.contracts.find(dispute.contractId);
      if (!contract) return null;
      const now = this.deps.clock.now();
      dispute.close(now);
      contract.settle(dispute.id, now);
      await this.deps.disputes.save(dispute);
      await this.deps.contracts.save(contract);
      await this.deps.projects.closeByDispute(contract.projectId);
      return contract;
    });
    return closed ? 'CLOSED' : 'SKIPPED';
  }

  /** false se a disputa não está em execução. */
  private refund(disputeId: string): Promise<boolean> {
    return this.deps.uow.run(async () => {
      const dispute = await this.deps.disputes.find(disputeId);
      const r = dispute?.resolution;
      if (dispute?.status !== 'EXECUTING' || !r) return false;
      if (r.refundCents === 0 || dispute.execution.refundedAt) return true;
      const now = this.deps.clock.now();
      let remaining = r.refundCents;
      // Mais recentes primeiro: adicionais antes do pagamento principal.
      const payments = (await this.deps.payments.listByContract(dispute.contractId))
        .filter((payment) => payment.refundableCents > 0)
        .reverse();
      for (const payment of payments) {
        if (remaining === 0) break;
        const part = Math.min(remaining, payment.refundableCents);
        if (payment.providerPaymentRef)
          await this.deps.gateway.refund(
            payment.providerPaymentRef,
            part,
            `dispute:${dispute.id}:refund:${payment.id}`,
          );
        payment.refundPartially(part, now);
        await this.deps.payments.save(payment);
        remaining -= part;
      }
      if (remaining > 0) throw new Error(`Pagamentos insuficientes para reembolsar ${remaining}.`);
      await this.deps.ledger.append(
        refundJournal(
          {
            id: this.deps.ids.next(),
            contractId: dispute.contractId,
            reference: `dispute:${dispute.id}`,
            createdAt: now,
          },
          r.refundCents,
        ),
      );
      dispute.markRefunded(now);
      await this.deps.disputes.save(dispute);
      return true;
    });
  }

  /** false se o repasse espera a conta de recebimento do freelancer. */
  private transfer(disputeId: string): Promise<boolean> {
    return this.deps.uow.run(async () => {
      const dispute = await this.deps.disputes.find(disputeId);
      const r = dispute?.resolution;
      if (dispute?.status !== 'EXECUTING' || !r) return true;
      if (r.freelancerCents === 0 || dispute.execution.transferRef) return true;
      const contract = await this.deps.contracts.find(dispute.contractId);
      if (!contract) return true;
      const now = this.deps.clock.now();
      const account = await this.readyPayoutAccount(contract.freelancerId);
      if (!account) {
        const reason = 'Conta de recebimento do freelancer';
        if (dispute.execution.waitingFor !== reason) {
          dispute.waitFor(reason, now);
          await this.deps.disputes.save(dispute);
        }
        return false;
      }
      const transferRef = await this.deps.gateway.createTransfer(
        {
          amountCents: r.freelancerCents,
          destinationAccountId: account.providerAccountId,
          contractId: contract.id,
        },
        `dispute:${dispute.id}:transfer`,
      );
      const base = { contractId: contract.id, reference: transferRef, createdAt: now };
      await this.deps.ledger.append(
        releaseJournal(
          { ...base, id: this.deps.ids.next() },
          { freelancerNetCents: r.freelancerCents, platformFeeCents: r.platformFeeCents },
        ),
      );
      await this.deps.ledger.append(
        payoutJournal({ ...base, id: this.deps.ids.next() }, r.freelancerCents),
      );
      dispute.markTransferred(transferRef, now);
      dispute.waitFor(null, now);
      await this.deps.disputes.save(dispute);
      return true;
    });
  }
}

/** Nova tentativa periódica das decisões ainda em execução (conta pronta, provedor de volta). */
export class RetryPendingSettlements extends ContractsUseCase {
  constructor(
    deps: ContractsDeps,
    private readonly settle: ExecuteSettlement,
  ) {
    super(deps);
  }

  async execute(): Promise<number> {
    let closed = 0;
    for (const disputeId of await this.deps.disputes.executing(50)) {
      try {
        if ((await this.settle.execute(disputeId)) === 'CLOSED') closed += 1;
      } catch {
        // Fica para a próxima rodada.
      }
    }
    return closed;
  }
}

export class ReadDisputes extends ContractsUseCase {
  issues(contractId: string) {
    return Promise.all([
      this.deps.outOfScope.listByContract(contractId),
      this.deps.disputes.findLatestByContract(contractId),
    ]);
  }

  adminList(view: 'open' | 'closed') {
    return this.deps.disputeQueries.adminList(view);
  }

  stats(userId: string) {
    return this.deps.disputeQueries.userStats(userId);
  }
}
