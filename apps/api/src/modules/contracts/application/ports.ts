import type { ProjectStatus, ProjectType } from '@f4d/contracts';
import type { AuditLogger } from '../../../shared/application/audit-log.js';
import type { Mailer } from '../../../shared/application/mailer.js';
import type { SettingsReader } from '../../../shared/application/settings-reader.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';
import type { Contract } from '../domain/contract.js';
import type { Journal, LedgerAccount } from '../domain/ledger.js';
import type { Payment } from '../domain/payment.js';

export interface CheckoutRequest {
  paymentId: string;
  contractId: string;
  amountCents: number;
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

export interface CheckoutSession {
  providerCheckoutId: string;
  url: string;
  expiresAt: Date;
}

export interface CheckoutState {
  state: 'open' | 'paid' | 'expired' | 'failed';
  paymentRef: string | null;
  amountCents: number;
}

/** Evento do provedor já verificado (assinatura) e traduzido para o vocabulário da plataforma. */
export type GatewayEvent =
  | {
      kind: 'payment.succeeded';
      id: string;
      checkoutId: string;
      paymentRef: string | null;
      amountCents: number;
    }
  | { kind: 'payment.failed'; id: string; checkoutId: string }
  | { kind: 'payment.expired'; id: string; checkoutId: string }
  | {
      kind: 'account.updated';
      id: string;
      accountId: string;
      detailsSubmitted: boolean;
      payoutsEnabled: boolean;
    }
  | { kind: 'ignored'; id: string; type: string };

/**
 * Porta de pagamento (ADR-0008). Stripe Connect é o primeiro adapter; um gateway brasileiro
 * (Pagar.me, Asaas) pode substituí-lo sem mudar domínio nem casos de uso.
 */
export interface PaymentGateway {
  readonly provider: string;
  createCheckout(request: CheckoutRequest, idempotencyKey: string): Promise<CheckoutSession>;
  retrieveCheckout(checkoutId: string): Promise<CheckoutState>;
  /** Fecha um checkout aberto (nunca falha: checkout já fechado é ignorado). */
  expireCheckout(checkoutId: string): Promise<void>;
  refund(paymentRef: string, amountCents: number, idempotencyKey: string): Promise<void>;
  /** Verifica a assinatura e traduz o evento; lança InvalidWebhookError se não for autêntico. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): GatewayEvent;
  createConnectedAccount(input: { userId: string; email: string }): Promise<string>;
  createOnboardingLink(
    accountId: string,
    urls: { returnUrl: string; refreshUrl: string },
  ): Promise<string>;
  retrieveAccount(
    accountId: string,
  ): Promise<{ detailsSubmitted: boolean; payoutsEnabled: boolean }>;
}

export interface ContractRepository {
  find(id: string): Promise<Contract | null>;
  findByInvitation(invitationId: string): Promise<Contract | null>;
  findLatestByProject(projectId: string): Promise<Contract | null>;
  save(contract: Contract): Promise<void>;
  awaitingPaymentPastDeadline(now: Date, limit: number): Promise<string[]>;
}

export interface PaymentRepository {
  findByCheckout(provider: string, checkoutId: string): Promise<Payment | null>;
  listByContract(contractId: string): Promise<Payment[]>;
  save(payment: Payment): Promise<void>;
  pendingCreatedBefore(date: Date, limit: number): Promise<Payment[]>;
}

export interface LedgerEntryView {
  journalId: string;
  kind: Journal['kind'];
  account: string;
  debitCents: number;
  creditCents: number;
  createdAt: Date;
}

export interface Ledger {
  append(journal: Journal): Promise<void>;
  entries(contractId: string): Promise<LedgerEntryView[]>;
  /** Saldo credor (créditos − débitos) de uma conta para o contrato. */
  balance(contractId: string, account: LedgerAccount): Promise<number>;
}

export interface WebhookInbox {
  /** Registra o evento; false se já tinha sido recebido (entrega repetida do provedor). */
  recordOnce(provider: string, eventId: string, type: string, now: Date): Promise<boolean>;
}

export interface PayoutAccountRecord {
  userId: string;
  provider: string;
  providerAccountId: string;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
}

export interface PayoutAccounts {
  find(userId: string): Promise<PayoutAccountRecord | null>;
  findByProviderAccount(provider: string, accountId: string): Promise<PayoutAccountRecord | null>;
  save(record: PayoutAccountRecord, now: Date): Promise<void>;
}

export interface ProjectInfo {
  id: string;
  clientId: string;
  title: string;
  type: ProjectType;
  status: ProjectStatus;
}

/** Porta para o módulo de projetos (fachada pública). */
export interface ProjectGateway {
  find(projectId: string): Promise<ProjectInfo | null>;
  startWork(projectId: string): Promise<void>;
}

export interface PeopleDirectory {
  find(userId: string): Promise<{ displayName: string; email: string } | null>;
}

export interface ContractsDeps {
  contracts: ContractRepository;
  payments: PaymentRepository;
  ledger: Ledger;
  inbox: WebhookInbox;
  payoutAccounts: PayoutAccounts;
  gateway: PaymentGateway;
  projects: ProjectGateway;
  people: PeopleDirectory;
  settings: SettingsReader;
  mailer: Mailer;
  audit: AuditLogger;
  uow: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  webAppUrl: string;
}

export const CONTRACTS_DEPS = Symbol('CONTRACTS_DEPS');
