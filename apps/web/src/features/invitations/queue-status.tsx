'use client';

import { Badge } from '@f4d/ui/components/badge';
import { Card } from '@f4d/ui/components/card';
import { useMyQueue } from './queries';

/** Transparência da fila: posição no nível e por quê (docs/architecture.md §10, risco 7). */
export function QueueStatusCard() {
  const query = useMyQueue();
  const queue = query.data;
  if (!queue) return null;
  if (!queue.inQueue) {
    return (
      <Card tone="surface" className="flex flex-col gap-2">
        <h2 className="text-h4 font-medium">Fila de projetos</h2>
        <p className="text-body">Você entra na fila assim que o seu perfil for aprovado.</p>
      </Card>
    );
  }
  return (
    <Card tone={queue.tier === 'PRIORITY' ? 'accent' : 'surface'} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-h4 font-medium">Sua vez na fila</h2>
        {queue.level ? <Badge>Nível {queue.level.name}</Badge> : null}
        {queue.tier === 'PRIORITY' ? <Badge tone="dark">Prioridade</Badge> : null}
      </div>
      {queue.state === 'ACTIVE' && queue.position !== null ? (
        <p className="text-body">
          Você é o <strong className="text-h4">{queue.position}º</strong> de {queue.totalInLevel} no
          seu nível. Convites saem em rodadas, na ordem da fila, para projetos compatíveis com seus
          tipos de projeto e stacks.
        </p>
      ) : queue.state === 'MONITORING' ? (
        <p className="text-body">
          Você está em acompanhamento: depois de algumas rodadas sem ser escolhido, um especialista
          revisa seu perfil e propostas com você antes de voltar à fila — com prioridade.
        </p>
      ) : (
        <p className="text-body">Você está fora da fila no momento.</p>
      )}
      {queue.tier === 'PRIORITY' ? (
        <p className="text-sm">
          Como sua última proposta não foi escolhida, você está na frente na próxima rodada.
        </p>
      ) : null}
    </Card>
  );
}
