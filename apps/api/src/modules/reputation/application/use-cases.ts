import type { Level, PromotionProgress, Reputation, ReputationStats } from '@f4d/contracts';
import type { PromotionRule } from '@f4d/contracts';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import { NotFoundError } from '../../../shared/kernel/domain-error.js';
import {
  computeScore,
  evaluatePromotion,
  onTimeRate,
  ratingAvg,
  type RawStats,
  responseRate,
} from '../domain/reputation.js';
import type { LevelRecord, ReputationDeps, StoredStats } from './ports.js';

const EMPTY: RawStats = {
  completedContracts: 0,
  startedContracts: 0,
  ratingCount: 0,
  ratingSum: 0,
  onTimeContracts: 0,
  abandonments: 0,
  invitationsAnswered: 0,
  invitationsExpired: 0,
};

const toLevel = (level: LevelRecord): Level => ({
  slug: level.slug,
  name: level.name,
  rank: level.rank,
});

const percent = (value: number) => `${Math.round(value * 100)}%`;

abstract class ReputationUseCase {
  constructor(protected readonly deps: ReputationDeps) {}

  protected async ladder() {
    const levels = (await this.deps.levels.list()).sort((a, b) => a.rank - b.rank);
    const next = (slug: string) => {
      const index = levels.findIndex((level) => level.slug === slug);
      return index >= 0 ? (levels[index + 1] ?? null) : null;
    };
    return { levels, next, find: (slug: string) => levels.find((level) => level.slug === slug) };
  }

  protected present(stats: StoredStats | null): ReputationStats {
    const raw = stats ?? EMPTY;
    return {
      completedContracts: raw.completedContracts,
      startedContracts: raw.startedContracts,
      ratingCount: raw.ratingCount,
      ratingAvg: ratingAvg(raw),
      onTimeRate: onTimeRate(raw),
      abandonments: raw.abandonments,
      responseRate: responseRate(raw),
      score: stats?.score ?? 0.5,
      computedAt: stats?.computedAt.toISOString() ?? null,
    };
  }
}

/**
 * Job noturno (e "recalcular agora" no painel): estatísticas e score de cada freelancer aprovado
 * e progressão de nível. Regra automática promove; manual vira sugestão para o Admin. O score
 * novo vai para a fila por evento (`reputation.ScoreChanged`).
 */
export class RecomputeReputation extends ReputationUseCase {
  async execute(userIds?: readonly string[]): Promise<{ recomputed: number; promoted: number }> {
    const freelancers = await this.deps.source.freelancers(userIds);
    const previous = await this.deps.stats.findMany(freelancers.map((f) => f.userId));
    const { next, find } = await this.ladder();
    const now = this.deps.clock.now();
    let promoted = 0;
    for (const freelancer of freelancers) {
      const { score, components } = computeScore(freelancer.raw);
      const before = previous.get(freelancer.userId);
      await this.deps.uow.run(() =>
        this.deps.stats.save(
          { ...freelancer.raw, userId: freelancer.userId, score, components, computedAt: now },
          before?.score !== score,
        ),
      );
      const target = next(freelancer.levelSlug);
      const rule = find(freelancer.levelSlug)?.promotion;
      if (!target || !rule?.automatic) continue;
      if (!evaluatePromotion(freelancer.raw, score, rule).eligible) continue;
      const done = await this.deps.promoter.promote({
        userId: freelancer.userId,
        fromLevel: freelancer.levelSlug,
        toLevel: target.slug,
        reason: promotionReason(freelancer.raw, score),
        promotedBy: null,
      });
      if (done) promoted += 1;
    }
    return { recomputed: freelancers.length, promoted };
  }
}

const promotionReason = (raw: RawStats, score: number): string => {
  const rating = ratingAvg(raw);
  const onTime = onTimeRate(raw);
  return [
    'Progressão automática:',
    `${raw.completedContracts} ${raw.completedContracts === 1 ? 'projeto concluído' : 'projetos concluídos'}`,
    rating === null ? null : `nota média ${rating.toFixed(1).replace('.', ',')}`,
    onTime === null ? null : `${percent(onTime)} no prazo`,
    `desempenho ${score.toFixed(2).replace('.', ',')}`,
  ]
    .filter(Boolean)
    .join(' · ')
    .replace(': · ', ': ');
};

export class ReadReputation extends ReputationUseCase {
  async forFreelancer(userId: string): Promise<Reputation> {
    const [snapshot] = await this.deps.source.freelancers([userId]);
    const stored = await this.deps.stats.find(userId);
    const { next, find } = await this.ladder();
    const level = snapshot ? find(snapshot.levelSlug) : undefined;
    const history = await this.deps.history.list(userId);
    let progress: PromotionProgress | null = null;
    const target = snapshot ? next(snapshot.levelSlug) : null;
    if (snapshot && level?.promotion && target) {
      // Progresso com as contagens atuais (o score é o do último cálculo).
      const score = stored?.score ?? computeScore(snapshot.raw).score;
      const evaluation = evaluatePromotion(snapshot.raw, score, level.promotion);
      progress = {
        nextLevel: toLevel(target),
        automatic: level.promotion.automatic,
        eligible: evaluation.eligible,
        criteria: evaluation.criteria,
      };
    }
    return {
      level: level ? toLevel(level) : null,
      stats: this.present(stored),
      progress,
      levelHistory: history.map((entry) => ({
        from: entry.from,
        to: entry.to,
        fromName: entry.fromName,
        toName: entry.toName,
        reason: entry.reason,
        automatic: entry.changedBy === null && entry.from !== null,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  /** Quem já cumpre a regra de um nível sem promoção automática. */
  async suggestions() {
    const { next, levels } = await this.ladder();
    const manual = levels.filter((level) => level.promotion && !level.promotion.automatic);
    if (manual.length === 0) return [];
    const freelancers = (await this.deps.source.freelancers()).filter((f) =>
      manual.some((level) => level.slug === f.levelSlug),
    );
    const stored = await this.deps.stats.findMany(freelancers.map((f) => f.userId));
    return freelancers.flatMap((freelancer) => {
      const level = manual.find((item) => item.slug === freelancer.levelSlug)!;
      const target = next(level.slug);
      const stats = stored.get(freelancer.userId) ?? null;
      const score = stats?.score ?? 0.5;
      if (!target || !evaluatePromotion(freelancer.raw, score, level.promotion!).eligible)
        return [];
      return [
        {
          userId: freelancer.userId,
          displayName: freelancer.displayName,
          level: toLevel(level),
          nextLevel: toLevel(target),
          stats: this.present(stats),
        },
      ];
    });
  }

  async levels() {
    const { levels, next } = await this.ladder();
    const counts = await this.deps.levels.countByLevel();
    return levels.map((level) => {
      const target = next(level.slug);
      return {
        level: toLevel(level),
        nextLevel: target ? toLevel(target) : null,
        promotion: target ? level.promotion : null,
        freelancers: counts.get(level.slug) ?? 0,
      };
    });
  }
}

export class ManageLevelRules extends ReputationUseCase {
  async update(
    adminId: string,
    slug: string,
    promotion: PromotionRule | null,
    meta: RequestMeta,
  ): Promise<void> {
    const { find, next } = await this.ladder();
    const level = find(slug);
    if (!level) throw new NotFoundError('Nível', slug);
    if (promotion && !next(slug)) throw new NotFoundError('Próximo nível', slug);
    await this.deps.uow.run(async () => {
      await this.deps.levels.update(slug, promotion);
      await this.deps.audit.record({
        actorId: adminId,
        action: 'admin.promotion_rule_updated',
        targetType: 'level',
        targetId: slug,
        metadata: { before: level.promotion, after: promotion },
        request: meta,
      });
    });
  }
}
