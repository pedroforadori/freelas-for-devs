import type { QueueState, QueueTier } from '@f4d/contracts';
import { AggregateRoot } from '../../../shared/kernel/aggregate-root.js';
import { InvalidStateTransitionError } from '../../../shared/kernel/domain-error.js';

export interface QueueEntrySnapshot {
  userId: string;
  levelSlug: string;
  state: QueueState;
  tier: QueueTier;
  prioritySince: Date | null;
  lastInvitedAt: Date | null;
  roundsWithoutSelection: number;
  openInvitations: number;
  declines: number;
  noResponses: number;
  selections: number;
  abandonments: number;
  /** Desempenho (0 a 1; 0,5 neutro) calculado pela reputação. */
  score: number;
  monitoringSince: Date | null;
  updatedAt: Date;
  version: number;
}

export const QueueEvents = {
  MonitoringStarted: 'distribution.MonitoringStarted',
  Reactivated: 'distribution.FreelancerReactivated',
} as const;

export type LostTurnReason = 'DECLINED' | 'EXPIRED' | 'WITHDRAWN';

/**
 * Lugar do freelancer na fila do nível (docs/architecture.md §6). Regras de justiça:
 * - recusar, deixar expirar ou retirar a proposta = perde a vez (vai para o fim, sem prioridade);
 * - proposta não escolhida = prioridade na próxima rodada (quem espera há mais tempo primeiro);
 * - N rodadas seguidas sem escolha = acompanhamento pelo Admin (sai da fila até reativação).
 * `openInvitations` conta só convites aguardando resposta (limite por freelancer).
 */
export class QueueEntry extends AggregateRoot {
  protected readonly aggregateType = 'QueueEntry';

  private constructor(
    private props: Omit<QueueEntrySnapshot, 'userId' | 'version'>,
    userId: string,
    version: number,
  ) {
    super(userId, version);
  }

  static create(userId: string, levelSlug: string, now: Date): QueueEntry {
    return new QueueEntry(
      {
        levelSlug,
        state: 'ACTIVE',
        tier: 'NORMAL',
        prioritySince: null,
        lastInvitedAt: null,
        roundsWithoutSelection: 0,
        openInvitations: 0,
        declines: 0,
        noResponses: 0,
        selections: 0,
        abandonments: 0,
        score: 0.5,
        monitoringSince: null,
        updatedAt: now,
      },
      userId,
      0,
    );
  }

  static rehydrate(snapshot: QueueEntrySnapshot): QueueEntry {
    const { userId, version, ...props } = snapshot;
    return new QueueEntry({ ...props }, userId, version);
  }

  get userId(): string {
    return this.id;
  }
  get state(): QueueState {
    return this.props.state;
  }
  get score(): number {
    return this.props.score;
  }

  updateScore(score: number, now: Date): void {
    this.props.score = score;
    this.props.updatedAt = now;
  }

  changeLevel(levelSlug: string, now: Date): void {
    this.props.levelSlug = levelSlug;
    this.props.updatedAt = now;
  }

  invited(now: Date): void {
    this.props.lastInvitedAt = now;
    this.props.openInvitations += 1;
    this.props.updatedAt = now;
  }

  /** Respondeu com proposta: o convite deixa de contar como pendente. */
  answered(now: Date): void {
    this.decrementOpen();
    this.props.updatedAt = now;
  }

  lostTurn(reason: LostTurnReason, now: Date): void {
    if (reason !== 'WITHDRAWN') this.decrementOpen();
    this.props.tier = 'NORMAL';
    this.props.prioritySince = null;
    this.props.lastInvitedAt = now;
    if (reason === 'EXPIRED') this.props.noResponses += 1;
    else this.props.declines += 1;
    this.props.updatedAt = now;
  }

  /** Convite anulado sem culpa do freelancer (projeto cancelado, outro escolhido antes). */
  voided(wasAwaitingResponse: boolean, now: Date): void {
    if (wasAwaitingResponse) this.decrementOpen();
    this.props.updatedAt = now;
  }

  hired(now: Date): void {
    this.props.tier = 'NORMAL';
    this.props.prioritySince = null;
    this.props.roundsWithoutSelection = 0;
    this.props.lastInvitedAt = now;
    this.props.selections += 1;
    this.props.updatedAt = now;
  }

  notSelected(roundsBeforeMonitoring: number, now: Date): void {
    this.props.roundsWithoutSelection += 1;
    if (this.props.roundsWithoutSelection >= roundsBeforeMonitoring) {
      this.props.state = 'MONITORING';
      this.props.tier = 'NORMAL';
      this.props.prioritySince = null;
      this.props.monitoringSince = now;
      this.record(QueueEvents.MonitoringStarted, now, {
        userId: this.id,
        rounds: this.props.roundsWithoutSelection,
      });
    } else {
      this.givePriority(now);
    }
    this.props.updatedAt = now;
  }

  /**
   * Abandonou um contrato: perde qualquer prioridade e só volta a ser convidado depois da
   * penalidade (a chave de justiça usa `lastInvitedAt`; uma data futura o mantém no fim).
   */
  abandoned(penaltyDays: number, now: Date): void {
    this.props.tier = 'NORMAL';
    this.props.prioritySince = null;
    this.props.lastInvitedAt = new Date(now.getTime() + penaltyDays * 24 * 60 * 60 * 1000);
    this.props.abandonments += 1;
    this.props.updatedAt = now;
  }

  /** Projeto cancelado depois da proposta: não foi rejeitado, então ganha prioridade sem contar rodada. */
  compensate(now: Date): void {
    if (this.props.state === 'ACTIVE') this.givePriority(now);
    this.props.updatedAt = now;
  }

  reactivate(now: Date): void {
    if (this.props.state !== 'MONITORING')
      throw new InvalidStateTransitionError('QueueEntry', this.props.state, 'reactivate');
    this.props.state = 'ACTIVE';
    this.props.tier = 'PRIORITY';
    this.props.prioritySince = now;
    this.props.roundsWithoutSelection = 0;
    this.props.monitoringSince = null;
    this.props.updatedAt = now;
    this.record(QueueEvents.Reactivated, now, { userId: this.id });
  }

  toSnapshot(): QueueEntrySnapshot {
    return { ...this.props, userId: this.id, version: this.version };
  }

  private givePriority(now: Date): void {
    if (this.props.tier !== 'PRIORITY') {
      this.props.tier = 'PRIORITY';
      this.props.prioritySince = now;
    }
  }

  private decrementOpen(): void {
    this.props.openInvitations = Math.max(0, this.props.openInvitations - 1);
  }
}
