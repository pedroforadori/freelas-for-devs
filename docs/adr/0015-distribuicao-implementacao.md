# ADR-0015: Implementação da fila justa (F5)

- **Status:** Aceito
- **Data:** 2026-10-09

## Contexto

O algoritmo da fila (docs/architecture.md §6) precisava virar código com quatro garantias: consistência sob concorrência, prazos confiáveis, módulos desacoplados e regras explicáveis. Algumas decisões de detalhe não estavam fixadas no plano.

## Decisão

- **Agregados:**
  - `DistributionRound` controla as vagas (K), o teto de convites, a faixa da proposta e a escolha, e contém os convites.
  - `QueueEntry` guarda a posição de cada freelancer.
  - Cada operação da rodada devolve "efeitos na fila" (perder a vez, prioridade, contratação), aplicados na mesma transação.
- **Concorrência:**
  - Advisory lock por nível (`pg_advisory_xact_lock`) durante o preenchimento das vagas.
  - Candidatos selecionados com `FOR UPDATE SKIP LOCKED`.
  - Lock otimista (`version`) na rodada e nas entradas da fila.
  - Índice único (projeto, freelancer): ninguém é convidado duas vezes para o mesmo projeto.
- **Ordem:**
  - Primeiro `PRIORITY`, por `priority_since`.
  - Depois `NORMAL`, por `last_invited_at` (nunca convidado vai à frente).
  - Desempate por id.
  - O bônus por desempenho (`score`) fica para a F9; até lá todos contam como neutros (0,5), o que dá a mesma ordem.
- **Prazos:** só o reconciliador, um job agendado a cada minuto (`upsertJobScheduler`) que expira convites vencidos e repõe as vagas. O prazo vive no banco; não há job atrasado por convite (delayed job). Para prazos de 48 h, a precisão de um minuto basta, e o reconciliador cobre a perda de jobs sem duplicar caminhos.
- **Convites abertos por freelancer** contam só os que aguardam resposta. Proposta enviada deixa de contar, para não travar quem espera a decisão do cliente.
- **Entre módulos:**
  - A distribuição consome `ScopeApproved`, `ProjectCancelled`, `FreelancerProfileApproved` e `FreelancerLevelChanged` pelo roteador de eventos do worker.
  - Ela muda o estado do projeto (`DISTRIBUTING`, `NO_CANDIDATES`, `HIRING`) pela fachada pública `ProjectsFacade`, dentro da mesma transação, sem importar o domínio de projetos.
- **Snapshot:** K, teto, prazo de resposta, limite de convites abertos, N de acompanhamento e a faixa e o prazo do escopo são copiados para a rodada na abertura.
- **Pagamento:** a confirmação e a expiração do pagamento ficam com a F6. `FinalizeHiring` já implementa o desfecho (contratado e não escolhidos, com prioridade e acompanhamento) e será chamado pelo webhook de pagamento.

## Consequências

- Os convites chegam em até ~1 minuto depois da aprovação do escopo (outbox → worker).
- O cliente vê quantos convidados ainda vão responder, mas não quem são.
- A proposta não passa ainda pelo detector de contato. Ele entra na F3 junto com o chat, e o texto da proposta também será verificado.
