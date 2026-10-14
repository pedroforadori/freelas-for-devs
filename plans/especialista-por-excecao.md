# Especialista só nas exceções + orçamento informado pelo cliente

> Status: planejado em 2026-10-14, não executado. Pendente: confirmar a semântica do orçamento (piso das propostas).

## Context

Hoje **todo** projeto para em `SCOPING`: um Admin (o fundador) escreve o escopo no editor (objetivo, funcionalidades, critérios de aceite, nível, stacks, faixa de preço e prazo), salva uma versão e aprova. Só depois disso o evento `projects.ScopeApproved` dispara a distribuição. O risco 4 da §10 de `docs/architecture.md` já aponta isso como gargalo. Para enxugar o MVP:

- O especialista sai do caminho feliz e **só entra nas exceções**.
- A IA escreve **só o escopo (objetivo, funcionalidades e telas), os critérios de aceite e o nível**. Ela não define mais faixa de preço, prazo nem stacks.
- O **cliente informa o orçamento** ao publicar. A IA ainda calcula um **preço interno**, que nunca aparece para o cliente nem limita propostas: ele serve só para detectar um orçamento fora da realidade.
- As **stacks exigidas saem**: a fila filtra só por nível.
- Fluxo **automático**: sem exceção, a distribuição começa sozinha, sem confirmação do cliente.

### Novo fluxo

```
publica (com orçamento) → ESTIMATING → (esclarecimentos, uma vez) → IA gera escopo + critérios + nível (+ preço interno)
  ├─ sem exceção → escopo v1 "automático" → READY_FOR_QUEUE → ScopeApproved → distribuição
  └─ exceção     → SCOPING (fila do especialista: aprovar / ajustar / recusar / conversar no chat)
Exceções: a IA falhou | reviewNotes não vazios (ilegal ou fora do foco) | orçamento < mínimo da IA × (1 − tolerância)
NO_CANDIDATES → especialista reabre (sem mudança)
```

**Semântica do orçamento** (é a interpretação de "valor mínimo de orçamento"; precisa ser confirmada): `budgetCents` é o **piso** das propostas. O dev propõe um valor ≥ orçamento e um prazo ≤ `scope.maxDeadlineDays` (Settings). Sem teto: o cliente compara as propostas.

## Mudanças

### Contratos (`packages/contracts/src/modules/projects.ts`, `settings.ts`, `distribution.ts`)
- `createProjectRequestSchema`: novo campo `budgetCents` (inteiro positivo; o mínimo vem de `scope.minPriceCents`, validado na API).
- `scopeInputSchema` / `scopeSchema`: trocar `priceRange` + `deadlineDays` por `budgetCents` e remover `requiredStacks`. `clientScopeSchema` segue omitindo `levelSlug`.
- `clientEstimateSchema`: remover `priceRange` e `durationDays` (o cliente vê resumo, funcionalidades e premissas). `estimateSchema` (Admin) troca a faixa de preço e o prazo por `internalPrice` (`{ minCents, maxCents }`, usado só na checagem), remove `suggestedStacks` e ganha `objective`, `screens` e `acceptanceCriteria`.
- `projectSchema` / `adminProjectDetailSchema`: expor `budgetCents`. No Admin, adicionar `reviewReasons: ('AI_FAILED'|'AI_ALERTS'|'BUDGET_GAP')[]`.
- Nova setting `scope.budgetGapTolerancePct` (padrão 40).
- Labels: `SCOPING` passa de "Escopo com especialista" para "Em análise"; `READY_FOR_QUEUE` passa a "Publicado".
- Proposta (`distribution.ts`): validar `amount ≥ budget` e o prazo pelo teto global. Regerar `openapi.json` e `api-client`.

### Domínio e aplicação (`apps/api/src/modules/projects/`)
- `domain/project.ts`: novo evento `autoApproveScope` (ESTIMATING → READY_FOR_QUEUE). `completeEstimate(estimate, limits, now)` monta o escopo a partir da saída da IA, decide se há exceção e ou registra a versão 1 com `createdBy: null` e emite `ScopeApproved`, ou vai para `SCOPING` com os motivos. Reaproveitar o caminho de `saveScope` + `approveScope` (`pullNewScopeVersions` e o evento) em vez de duplicar. `failEstimate`, `reject` e `reopenScope` não mudam.
- `saveScope`: validar `budgetCents ≥ minPriceCents`; a checagem de `deadlineDays` sai.
- `application/use-cases.ts`: `CompleteEstimate` lê as settings (mínimo e tolerância) e passa a regra ao domínio. `ManageScope.assertCatalog` passa a checar só o nível e também vale para o nível sugerido pela IA: se ele não existir no catálogo, o projeto cai em exceção.
- `application/emails.ts`: "estimativa pronta" vira "projeto publicado para os devs" no caminho automático e "em análise" na exceção. `scopeApprovedEmail` fica só para a aprovação manual.

### IA (`infrastructure/estimation/`)
- `prompt.ts`: a ferramenta de estimativa passa a pedir `objective`, `features`, `screens`, `acceptanceCriteria`, `suggestedLevel`, `internalPrice` e `reviewNotes`. Saem `durationDays` e `suggestedStacks`, junto com a regra 6. A `MARKET_REFERENCE` continua como âncora do preço interno. O texto deixa de dizer "revisada por um especialista humano". Subir `promptVersion`.
- `estimator-output.ts`, `heuristic-estimator.ts` e `application/estimate-policy.ts`: acompanhar os campos novos (a heurística gera critérios genéricos; a policy deixa de deduplicar e filtrar stacks). Os testes dos estimadores Claude e Gemini também precisam ser ajustados.

### Distribuição (`apps/api/src/modules/distribution/`)
- `application/use-cases.ts:187-199` e `domain/round.ts:195-200`: os parâmetros da rodada passam de `priceMin/priceMax/maxDeadlineDays` do escopo para `budgetCents` do escopo + `scope.maxDeadlineDays` das settings. A mensagem de erro muda para "a partir de R$ X".
- `application/emails.ts`: tirar "O escopo já foi fechado com um especialista".
- `infrastructure/drizzle-distribution.ts:428`: o convite expõe `budgetCents`.
- Stacks: remover `requiredStacks` de `domain/round.ts`, `application/ports.ts`, `use-cases.ts:39,189` e do filtro em `drizzle-distribution.ts:330-338`. A coluna `rounds.required_stacks` é removida na migration.

### Banco (`apps/api/src/db/`)
- Migration `0017_specialist_exceptions.sql`:
  - Em `projects`: novas colunas `budget_cents integer` (nula nos projetos antigos) e `review_reasons jsonb`.
  - `scope_versions.created_by` passa a aceitar nulo (nulo = automático).
  - Sai a coluna de stacks da tabela de rodadas em `schema/distribution.ts`.
  - Os escopos jsonb antigos são convertidos (`budgetCents = priceRange.minCents`, sem `priceRange`, `deadlineDays` e `requiredStacks`), para que convites e contratos já existentes continuem legíveis.

### Web (`apps/web/src/`)
- `app/novo-projeto/page.tsx` e o formulário em `features/projects/`: campo "Quanto você pretende investir (mínimo)", em BRL. Ajustar o texto da linha 12.
- `features/projects/project-detail.tsx`: tirar o card de faixa e prazo (linhas ~150-185). Em `SCOPING`, mostrar "Seu projeto está em análise" (só exceções). Em `READY_FOR_QUEUE`/`DISTRIBUTING`, mostrar o escopo gerado (`scope-view.tsx` com orçamento em vez de faixa e prazo).
- `features/admin/project-queue.tsx`: a aba `SCOPING` vira "Em análise", com a coluna de motivo. `project-review.tsx`: bloco "Orçamento do cliente × estimativa da IA" com o desvio em %. `scope-editor.tsx`: trocar os campos de faixa e prazo por orçamento, remover o seletor de stacks e pré-preencher objetivo e critérios com a saída da IA. `project-review.tsx:101` e `scope-view.tsx:18-21`: tirar a exibição de stacks.
- `features/invitations/invitation-detail.tsx:144-207`: o valor tem mínimo igual ao orçamento e não tem máximo; o prazo vai até o teto global. `invitation-list.tsx:73`: mostrar "a partir de R$ X".
- `features/invitations/queue-status.tsx` e `chat-panel.tsx`: manter "Especialista" como papel no chat (o canal continua para as exceções).

### Landing e docs
- `apps/landing/src/content/home.ts` (linhas 84, 106, 180) e `app/privacidade/page.tsx:75`: tirar "faixa de preço e prazo na hora" e "especialista fecha o escopo". O novo texto fala de escopo e critérios de aceite gerados na hora e de propostas dos devs a partir do seu orçamento.
- Novo `docs/adr/0022-especialista-por-excecao.md`. Atualizar `docs/architecture.md` (§4.1, o risco 4 da §10 e o item 6 da landing) e `docs/adr/0013-estimativa-ia.md` (preço interno).

### Métricas
- `ReadScopingMetrics` / `drizzle-projects.ts:271`: incluir `autoApproved` (30 dias) e a taxa de exceção por motivo. `estimateDeviation` passa a medir orçamento × preço interno da IA, que é a base para calibrar a tolerância.

## Fora do escopo
- O chat de escopo continua como está (status abertos iguais) e fica útil nas exceções.
- O fluxo de `NO_CANDIDATES` e a reabertura pelo especialista não mudam.

## Verificação
1. `pnpm turbo run typecheck lint test` (consultar antes os docs do turbo instalado, conforme o AGENTS.md).
2. Testes de domínio em `project.test.ts`: aprovação automática; exceção por desvio de orçamento (com a borda da tolerância); exceção por `reviewNotes`; falha da IA.
3. E2E: ajustar `projects`, `scope`, `distribution` e `messaging`. Casos novos: (a) publica com orçamento ok → convites criados sem ação do Admin; (b) orçamento muito baixo → `SCOPING` com motivo `BUDGET_GAP` → Admin aprova → distribuição; (c) proposta abaixo do orçamento → 422. O caso de stacks em `distribution.e2e.test.ts:314` sai; o de fila esgotada continua, só por nível.
4. Manual (web na porta 3010; não matar a porta 3000): publicar um projeto como cliente, ver os convites chegarem ao dev e enviar uma proposta; publicar outro com orçamento irrisório e conferir que ele aparece em "Em análise" no Admin.
