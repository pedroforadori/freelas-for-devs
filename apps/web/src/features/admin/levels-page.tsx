'use client';

import { unwrap } from '@f4d/api-client';
import { type LevelWithRule, type PromotionRule, promotionRuleSchema } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { Field, Input } from '@f4d/ui/components/field';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';

const levelsKey = ['admin', 'levels'] as const;
const suggestionsKey = ['admin', 'reputation', 'suggestions'] as const;

const DEFAULT_RULE: PromotionRule = {
  minCompleted: 3,
  minRatingAvg: 4,
  minOnTimeRate: 0.7,
  minScore: 0.55,
  maxAbandonments: 0,
  automatic: true,
};

/** Níveis, regras de progressão, sugestões de promoção e recálculo da reputação. */
export function LevelsPage() {
  const queryClient = useQueryClient();
  const levels = useQuery({
    queryKey: levelsKey,
    queryFn: () => unwrap(api.GET('/v1/admin/levels')),
  });
  const recompute = useMutation({
    mutationFn: () => unwrap(api.POST('/v1/admin/reputation/recompute')),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: levelsKey });
      void queryClient.invalidateQueries({ queryKey: suggestionsKey });
    },
  });
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-h3 font-medium">Níveis e reputação</h1>
        <p className="text-body text-muted">
          Toda noite (03:00) a plataforma recalcula as estatísticas e o desempenho de cada
          freelancer. Quem cumpre a regra do seu nível sobe sozinho; nas regras manuais, aparece em
          “Sugestões” para você decidir.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={recompute.isPending} onClick={() => recompute.mutate()}>
          {recompute.isPending ? 'Recalculando…' : 'Recalcular agora'}
        </Button>
        {recompute.data ? (
          <span className="text-body" role="status">
            {recompute.data.recomputed} recalculados · {recompute.data.promoted} promovidos
          </span>
        ) : null}
        {recompute.isError ? <Alert tone="error">{errorMessage(recompute.error)}</Alert> : null}
      </div>
      <Suggestions />
      {levels.isError ? <Alert tone="error">{errorMessage(levels.error)}</Alert> : null}
      <ul className="flex flex-col gap-4">
        {levels.data?.items.map((item) => (
          <li key={item.level.slug}>
            <LevelCard item={item} />
          </li>
        ))}
      </ul>
    </>
  );
}

function Suggestions() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: suggestionsKey,
    queryFn: () => unwrap(api.GET('/v1/admin/reputation/suggestions')),
  });
  const promote = useMutation({
    mutationFn: (input: { userId: string; levelSlug: string; levelName: string }) =>
      unwrap(
        api.POST('/v1/admin/freelancers/{userId}/level', {
          params: { path: { userId: input.userId } },
          body: {
            levelSlug: input.levelSlug,
            reason: `Promoção revisada: cumpriu os critérios para ${input.levelName}.`,
          },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: suggestionsKey });
      void queryClient.invalidateQueries({ queryKey: levelsKey });
    },
  });
  const items = query.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <Card tone="accent" className="flex flex-col gap-4">
      <h2 className="text-h4 font-medium">Sugestões de promoção</h2>
      {promote.isError ? <Alert tone="error">{errorMessage(promote.error)}</Alert> : null}
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li
            key={item.userId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-button bg-bg p-4"
          >
            <div>
              <Link href={`/admin/freelancers/${item.userId}`} className="font-medium underline">
                {item.displayName}
              </Link>
              <p className="text-sm">
                {item.level.name} → {item.nextLevel.name} · {item.stats.completedContracts}{' '}
                concluídos · nota {item.stats.ratingAvg?.toFixed(1).replace('.', ',') ?? '—'} ·
                desempenho {item.stats.score.toFixed(2).replace('.', ',')}
              </p>
            </div>
            <Button
              disabled={promote.isPending}
              onClick={() =>
                promote.mutate({
                  userId: item.userId,
                  levelSlug: item.nextLevel.slug,
                  levelName: item.nextLevel.name,
                })
              }
            >
              Promover a {item.nextLevel.name}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function LevelCard({ item }: { item: LevelWithRule }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PromotionRule>(item.promotion ?? DEFAULT_RULE);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (promotion: PromotionRule | null) =>
      unwrap(
        api.PUT('/v1/admin/levels/{slug}/promotion', {
          params: { path: { slug: item.level.slug } },
          body: { promotion },
        }),
      ),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: levelsKey });
    },
    onError: (saveError) => setError(errorMessage(saveError)),
  });
  const submit = () => {
    const parsed = promotionRuleSchema.safeParse(draft);
    if (!parsed.success) {
      setError('Confira os valores: notas de 1 a 5 e percentuais de 0 a 100.');
      return;
    }
    setError(null);
    save.mutate(parsed.data);
  };
  const rule = item.promotion;
  const number = (key: keyof PromotionRule, scale = 1) => ({
    value: String(Math.round(Number(draft[key]) * scale * 100) / 100),
    onChange: (event: { target: { value: string } }) =>
      setDraft({ ...draft, [key]: Number(event.target.value.replace(',', '.')) / scale }),
    inputMode: 'decimal' as const,
  });

  return (
    <Card tone="white" className="flex flex-col gap-4 border border-dark">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-h4 font-medium">{item.level.name}</h2>
        <Badge>{item.freelancers} freelancers</Badge>
        {item.nextLevel && rule ? (
          <Badge tone={rule.automatic ? 'accent' : 'neutral'}>
            {rule.automatic ? 'Promoção automática' : 'Promoção revisada'}
          </Badge>
        ) : null}
      </div>
      {!item.nextLevel ? (
        <p className="text-body text-muted">Nível mais alto: não há promoção a partir dele.</p>
      ) : !editing ? (
        <>
          {rule ? (
            <p className="text-body">
              Para subir a {item.nextLevel.name}: {rule.minCompleted}{' '}
              {rule.minCompleted === 1 ? 'projeto concluído' : 'projetos concluídos'} · nota média ≥{' '}
              {rule.minRatingAvg.toFixed(1).replace('.', ',')} · ≥{' '}
              {Math.round(rule.minOnTimeRate * 100)}% no prazo · desempenho ≥{' '}
              {rule.minScore.toFixed(2).replace('.', ',')} · no máximo {rule.maxAbandonments}{' '}
              abandonos.
            </p>
          ) : (
            <p className="text-body text-muted">
              Progressão desligada: só por reclassificação manual.
            </p>
          )}
          <div>
            <Button variant="outline" onClick={() => setEditing(true)}>
              Editar regra
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id={`${item.level.slug}-completed`} label="Projetos concluídos (mín.)">
              <Input id={`${item.level.slug}-completed`} {...number('minCompleted')} />
            </Field>
            <Field id={`${item.level.slug}-rating`} label="Nota média (mín., 1 a 5)">
              <Input id={`${item.level.slug}-rating`} {...number('minRatingAvg')} />
            </Field>
            <Field id={`${item.level.slug}-ontime`} label="No prazo (mín., %)">
              <Input id={`${item.level.slug}-ontime`} {...number('minOnTimeRate', 100)} />
            </Field>
            <Field id={`${item.level.slug}-score`} label="Desempenho (mín., 0 a 1)">
              <Input id={`${item.level.slug}-score`} {...number('minScore')} />
            </Field>
            <Field id={`${item.level.slug}-abandon`} label="Abandonos (máx.)">
              <Input id={`${item.level.slug}-abandon`} {...number('maxAbandonments')} />
            </Field>
          </div>
          <label className="flex items-center gap-3 text-body">
            <input
              type="checkbox"
              checked={draft.automatic}
              onChange={(event) => setDraft({ ...draft, automatic: event.target.checked })}
              className="size-5 accent-dark"
            />
            Promover automaticamente (senão, vira sugestão para revisão)
          </label>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="flex flex-wrap gap-3">
            <Button disabled={save.isPending} onClick={submit}>
              Salvar regra
            </Button>
            {rule ? (
              <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(null)}>
                Desligar progressão
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
