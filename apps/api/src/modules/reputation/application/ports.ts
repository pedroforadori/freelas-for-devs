import type { PromotionRule } from '@f4d/contracts';
import type { AuditLogger } from '../../../shared/application/audit-log.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import type { RawStats, ScoreComponents } from '../domain/reputation.js';

export interface FreelancerSnapshot {
  userId: string;
  displayName: string;
  levelSlug: string;
  raw: RawStats;
}

export interface StoredStats extends RawStats {
  userId: string;
  score: number;
  components: ScoreComponents;
  computedAt: Date;
}

/** Contagens a partir de contratos, avaliações, convites e disputas (read model). */
export interface ReputationSource {
  /** Freelancers aprovados (todos, ou só os informados) com as contagens atuais. */
  freelancers(userIds?: readonly string[]): Promise<FreelancerSnapshot[]>;
}

export interface StatsStore {
  find(userId: string): Promise<StoredStats | null>;
  findMany(userIds: readonly string[]): Promise<Map<string, StoredStats>>;
  /** Grava; com `scoreChanged`, publica `reputation.ScoreChanged` no outbox na mesma transação. */
  save(stats: StoredStats, scoreChanged: boolean): Promise<void>;
}

export interface LevelRecord {
  slug: string;
  name: string;
  rank: number;
  promotion: PromotionRule | null;
}

export interface LevelRules {
  list(): Promise<LevelRecord[]>;
  update(slug: string, promotion: PromotionRule | null): Promise<boolean>;
  countByLevel(): Promise<Map<string, number>>;
}

export interface LevelHistoryReader {
  list(userId: string): Promise<
    {
      from: string | null;
      to: string;
      fromName: string | null;
      toName: string;
      reason: string;
      changedBy: string | null;
      createdAt: Date;
    }[]
  >;
}

/** Fachada do módulo de perfis: muda o nível (histórico, evento e e-mail). */
export interface Promoter {
  promote(input: {
    userId: string;
    fromLevel: string;
    toLevel: string;
    reason: string;
    promotedBy: string | null;
  }): Promise<boolean>;
}

export interface ReputationDeps {
  source: ReputationSource;
  stats: StatsStore;
  levels: LevelRules;
  history: LevelHistoryReader;
  promoter: Promoter;
  audit: AuditLogger;
  uow: UnitOfWork;
  clock: Clock;
}

export const REPUTATION_DEPS = Symbol('REPUTATION_DEPS');
