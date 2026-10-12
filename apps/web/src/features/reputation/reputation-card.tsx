'use client';

import { unwrap } from '@f4d/api-client';
import {
  PROMOTION_CRITERION_LABELS,
  type PromotionCriterion,
  type PublicReputation,
  type Reputation,
} from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Card } from '@f4d/ui/components/card';
import { cn } from '@f4d/ui/cn';
import { useQuery } from '@tanstack/react-query';
import { dateTime } from '@/features/projects/format';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';

const decimal = (value: number, digits = 1) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Valor de um critério de progressão no formato em que ele é lido. */
const formatCriterion = (criterion: PromotionCriterion, value: number | null): string => {
  if (value === null) return '—';
  switch (criterion) {
    case 'RATING':
      return decimal(value);
    case 'ON_TIME':
      return percent(value);
    case 'SCORE':
      return decimal(value, 2);
    case 'COMPLETED':
    case 'ABANDONMENTS':
      return String(value);
  }
};

/** Reputação do freelancer logado (perfil). */
export function MyReputation() {
  const query = useQuery({
    queryKey: ['reputation', 'me'],
    queryFn: () => unwrap(api.GET('/v1/me/reputation')),
  });
  if (query.isError) return <Alert tone="error">{errorMessage(query.error)}</Alert>;
  if (!query.data?.level) return null;
  return <ReputationCard reputation={query.data} viewer="freelancer" />;
}

/** Estatísticas, progresso para o próximo nível e histórico (freelancer ou Admin). */
export function ReputationCard({
  reputation,
  viewer,
}: {
  reputation: Reputation;
  viewer: 'freelancer' | 'admin';
}) {
  const { stats, progress } = reputation;
  const tiles: [string, string][] = [
    ['Projetos concluídos', String(stats.completedContracts)],
    [
      'Nota média',
      stats.ratingAvg === null
        ? 'sem avaliações'
        : `${decimal(stats.ratingAvg)} (${stats.ratingCount})`,
    ],
    ['Entregas no prazo', stats.onTimeRate === null ? '—' : percent(stats.onTimeRate)],
    ['Convites respondidos', stats.responseRate === null ? '—' : percent(stats.responseRate)],
    ['Desempenho', decimal(stats.score, 2)],
  ];
  return (
    <Card tone="white" className="flex flex-col gap-6 border border-dark">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-h4 font-medium">
            {viewer === 'freelancer' ? 'Sua reputação' : 'Reputação'}
          </h2>
          {reputation.level ? <Badge tone="accent">Nível {reputation.level.name}</Badge> : null}
        </div>
        <p className="text-body text-muted">
          {viewer === 'freelancer'
            ? 'Calculada todas as noites a partir dos seus projetos. Sem histórico, o desempenho é neutro (0,5): ninguém começa em desvantagem. Ele ajusta sua vez na fila e conta para subir de nível.'
            : `Último cálculo: ${stats.computedAt ? dateTime.format(new Date(stats.computedAt)) : 'ainda não calculada'}.`}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {tiles.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-h4 font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      {progress ? (
        <div className="flex flex-col gap-3 border-t border-dark/20 pt-4">
          <h3 className="font-medium">
            Para chegar a {progress.nextLevel.name}
            {progress.eligible ? ' — critérios atendidos' : ''}
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {progress.criteria.map((item) => (
              <li
                key={item.criterion}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-button px-4 py-2',
                  item.met ? 'bg-accent' : 'bg-surface',
                )}
              >
                <span>
                  <span aria-hidden="true">{item.met ? '✓ ' : '○ '}</span>
                  {PROMOTION_CRITERION_LABELS[item.criterion]}
                  <span className="sr-only">{item.met ? ' (atendido)' : ' (pendente)'}</span>
                </span>
                <span className="text-sm whitespace-nowrap">
                  {formatCriterion(item.criterion, item.current)}{' '}
                  {item.criterion === 'ABANDONMENTS' ? 'de no máx.' : 'de'}{' '}
                  {formatCriterion(item.criterion, item.required)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            {progress.automatic
              ? 'Quando tudo estiver atendido, a promoção é automática no recálculo noturno.'
              : 'Neste nível, a promoção é revisada pela equipe quando os critérios forem atendidos.'}
          </p>
        </div>
      ) : (
        <p className="text-body">Você está no nível mais alto da plataforma.</p>
      )}

      {reputation.levelHistory.length > 0 ? (
        <details className="border-t border-dark/20 pt-4">
          <summary className="cursor-pointer font-medium">Histórico de nível</summary>
          <ol className="mt-3 flex flex-col gap-2">
            {reputation.levelHistory.map((entry) => (
              <li key={entry.createdAt} className="text-body">
                <span className="text-sm text-muted">
                  {dateTime.format(new Date(entry.createdAt))} ·{' '}
                </span>
                {entry.fromName
                  ? `${entry.fromName} → ${entry.toName}`
                  : `Aprovado como ${entry.toName}`}
                {entry.automatic ? <Badge className="ml-2">automática</Badge> : null}
                <span className="block text-sm text-muted">{entry.reason}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </Card>
  );
}

/** O que o cliente vê numa proposta: histórico real na plataforma. */
export function TrackRecord({ reputation }: { reputation: PublicReputation }) {
  if (reputation.completedContracts === 0) return <Badge>Primeiro projeto na plataforma</Badge>;
  return (
    <Badge>
      {reputation.ratingAvg === null
        ? ''
        : `★ ${decimal(reputation.ratingAvg)} (${reputation.ratingCount}) · `}
      {reputation.completedContracts}{' '}
      {reputation.completedContracts === 1 ? 'projeto concluído' : 'projetos concluídos'}
    </Badge>
  );
}
