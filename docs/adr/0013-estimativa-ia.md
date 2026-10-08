# ADR-0013: Estimativa de projetos com IA assíncrona e revisada por humano

- **Status:** Aceito
- **Data:** 2026-10-08

## Contexto

O cliente-alvo não sabe quanto custa software. A plataforma precisa mostrar uma faixa de preço e prazo logo após a publicação (meta: < 15 s), sem que isso vire orçamento fechado nem permita que um texto malicioso manipule o resultado.

## Decisão

- **Porta `ProjectEstimator`** no módulo de projetos. O adapter de produção usa **Claude** (`ANTHROPIC_MODEL`, padrão `claude-sonnet-5-5`) com **tool use estrito**: duas ferramentas, `submit_estimate` e `ask_clarifying_questions`. Na segunda rodada só a de estimativa é oferecida (`tool_choice` forçado), então a IA pergunta **no máximo uma vez**.
- **Assíncrono e confiável:** a publicação grava o projeto (`ESTIMATING`) e o evento `ProjectSubmitted` no outbox na mesma transação. O worker roteia o evento para a fila `estimation`, com `jobId` = projeto + rodada (idempotente). A chamada à IA acontece fora de transação. Antes de gravar, o projeto é relido: um resultado obsoleto (projeto cancelado, ou rodada já respondida) é descartado.
- **Falha:** 3 tentativas com backoff. Na última, o projeto segue para `SCOPING` sem estimativa (`estimateUnavailable`) e o especialista estima à mão.
- **Saída não confiável:** a resposta passa por schema Zod e por `normalizeEstimate`: nível e stacks só do catálogo, faixas ordenadas e arredondadas, listas limitadas. A descrição vai delimitada em `<pedido_do_cliente>` com instrução explícita de tratá-la como dado. Anexos nunca são enviados à IA.
- **Separação de visões:** o cliente vê faixa, prazo, resumo, funcionalidades e premissas. Nível sugerido, stacks, riscos e alertas (`reviewNotes`) ficam só com o Admin.
- **Custo e auditoria:** cada chamada grava modelo, versão do prompt (`PROMPT_VERSION`), tokens e duração em `ai_estimation_runs`. Por cliente, o limite é de 3 publicações por 24 h e 5 projetos em andamento.
- **Tempo real:** na F2 o web consulta o projeto a cada 2 s enquanto o status for `ESTIMATING`. A F3 troca esse polling por eventos via WebSocket.
- **Desenvolvimento:** `ESTIMATOR=heuristic` usa um estimador determinístico, sem IA. Em produção, o schema do ambiente exige `anthropic`.

## Alternativas descartadas

- **Chamada síncrona no request:** a latência fica nas mãos do provedor, sem retentativa e sem controle de custo.
- **JSON livre com parse do texto:** mais frágil que tool use com schema estrito.
- **Laço de perguntas:** pode não terminar e cansa o cliente.

## Consequências

- As faixas de referência do prompt são valores iniciais e precisam ser calibradas com os primeiros escopos fechados; qualquer mudança gera nova `PROMPT_VERSION`.
- O worker passa a consumir a fila `domain-events` (roteador `DomainEventsProcessor`), que os próximos módulos reutilizam.
