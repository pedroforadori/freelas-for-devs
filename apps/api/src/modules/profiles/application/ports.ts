import type { FreelancerProfileStatus, Level, Stack } from '@f4d/contracts';
import type { AuditLogger } from '../../../shared/application/audit-log.js';
import type { Mailer } from '../../../shared/application/mailer.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';
import type { FreelancerProfile } from '../domain/freelancer-profile.js';

export interface FreelancerProfileRepository {
  find(userId: string): Promise<FreelancerProfile | null>;
  /** Lock otimista; grava stacks, portfólio e eventos (outbox) na mesma transação. */
  save(profile: FreelancerProfile): Promise<void>;
}

export interface Catalog {
  listStacks(): Promise<Stack[]>;
  listLevels(): Promise<Level[]>;
  /** Slugs informados que não existem no catálogo. */
  unknownStacks(slugs: readonly string[]): Promise<string[]>;
  findLevel(slug: string): Promise<Level | null>;
  initialLevel(): Promise<Level>;
}

export interface LevelHistoryEntry {
  from: string | null;
  to: string;
  reason: string;
  changedAt: Date;
}

export interface LevelHistory {
  record(entry: {
    id: string;
    userId: string;
    from: string | null;
    to: string;
    reason: string;
    changedBy: string | null;
  }): Promise<void>;
  list(userId: string): Promise<LevelHistoryEntry[]>;
}

/** Dados de identidade usados na apresentação dos perfis (leitura; módulo de identidade é a fonte). */
export interface PeopleDirectory {
  find(userId: string): Promise<{ displayName: string; email: string } | null>;
}

export interface ReviewQueueItem {
  userId: string;
  displayName: string;
  email: string;
  headline: string;
  status: FreelancerProfileStatus;
  levelSlug: string | null;
  stacks: string[];
  submittedAt: Date | null;
}

export interface ReviewQueue {
  /** Paginação keyset por (submittedAt, userId): os mais antigos primeiro. */
  list(input: {
    status: FreelancerProfileStatus;
    limit: number;
    after: { submittedAt: Date | null; userId: string } | null;
  }): Promise<ReviewQueueItem[]>;
}

export interface ClientProfileRepository {
  find(userId: string): Promise<{ userId: string; companyName: string | null } | null>;
  upsert(profile: { userId: string; companyName: string | null }): Promise<void>;
}

export interface ProfilesDeps {
  profiles: FreelancerProfileRepository;
  clients: ClientProfileRepository;
  catalog: Catalog;
  levelHistory: LevelHistory;
  people: PeopleDirectory;
  reviewQueue: ReviewQueue;
  mailer: Mailer;
  audit: AuditLogger;
  uow: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  webAppUrl: string;
}

export const PROFILES_DEPS = Symbol('PROFILES_DEPS');
