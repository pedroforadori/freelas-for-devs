# ADR-0019: Fora de escopo, disputas e abandono (F8)

- **Status:** Aceito
- **Data:** 2026-10-12

## Contexto

O contrato (ADR-0016 e ADR-0017) só tinha o caminho feliz. Faltavam três situações:

- **Pedidos fora do escopo aprovado (§4.4).** Hoje viram trabalho grátis ou briga.
- **Disputas sobre o valor em custódia (§4.5).** A mediação precisa de uma forma de decidir quanto vai para cada lado.
- **Abandono.** O dev some ou desiste no meio do contrato.

## Decisão

### Pausa dos prazos

- O contrato guarda **travas** (`holds`):
  - `oos:<id>`: pedido fora de escopo pendente;
  - `dispute:<id>`: disputa aberta.
- A primeira trava registra `pausedAt`.
- Quando a última sai, o prazo combinado e a revisão em curso são estendidos pelo tempo parado.
- Pausado, nada vence: o reconciliador ignora contratos com `paused_at`.
- Com pedido fora de escopo pendente, o cliente não consegue aprovar.

### Fora de escopo: agregado `OutOfScopeRequest`

- O dev marca o pedido já com valor e dias adicionais. Os estados `FLAGGED` e `EXTRA_PROPOSED` do desenho viraram um passo só.
- O adicional recebe a comissão do contrato (mesma taxa e mesma regra de quem paga).
- O cliente tem três opções:
  - **aceitar:** paga à parte, num checkout próprio (`payments.out_of_scope_id`), com o prazo de pagamento das configurações. Confirmado o pagamento, os valores somam aos do contrato e o prazo é estendido;
  - **retirar** o pedido;
  - **contestar:** a mediação decide "dentro do escopo" (sem custo, os prazos voltam a correr) ou "fora" (o pedido volta para o cliente decidir).
- O dev pode desistir de cobrar.
- Adicional aceito e não pago no prazo é retirado por um reconciliador.

### Disputa: agregado `Dispute`

- **Abertura:**
  - Quem abre é uma das partes (`DISPUTE`).
  - No abandono (`ABANDONMENT`), abre o próprio dev ou a mediação, quando o dev some.
  - O contrato vai para `DISPUTED` e congela: nada de entregas nem aprovação.
  - Uma disputa ativa por contrato, garantida por índice único parcial.
- **Manifestações:**
  - As partes enviam sua versão (texto e arquivos) até `dispute.evidenceDays` (padrão: 3 dias).
  - A disputa vai para análise quando as duas falarem ou quando o prazo vencer (reconciliador).
  - Os estados `OPENED` e `COLLECTING_EVIDENCE` viraram `OPEN`.
- **Retirada:**
  - Só quem abriu, antes da análise. O contrato volta a andar com os prazos estendidos.
  - Abandono não se retira.
- **Decisão:**
  - A mediação decide a parte do valor reconhecida ao dev (0–100%).
  - `computeSettlement` está em `@f4d/contracts` e é usada pela API e pela prévia do painel, para nunca divergirem:
    - o dev recebe a fração decidida do seu líquido;
    - a plataforma fica com a comissão proporcional (sem repasse, sem comissão);
    - o restante volta ao cliente.
  - A soma é conferida contra o saldo `ESCROW` do razão antes de decidir.
  - Pedidos fora de escopo pendentes são encerrados.
- **Execução (worker em `DisputeResolved`, mais nova tentativa a cada 15 min e quando a conta de recebimento fica pronta):**
  - **Reembolso:** sai dos pagamentos mais recentes primeiro. É parcial quando preciso (`payments.refunded_cents`; `REFUNDED` só quando devolvido inteiro).
  - **Repasse:** espera a conta de recebimento (`execution.waitingFor`).
  - Cada passo tem chave de idempotência no provedor e é marcado feito na mesma transação.
  - Concluída a execução, a disputa fica `CLOSED`, o contrato `SETTLED` e o projeto `CLOSED_BY_DISPUTE`.
  - Não há estado `EXECUTION_FAILED`: a falha fica registrada e é repetida.

### Abandono

- Abre a disputa e publica `ContractAbandoned`.
- A fila aplica a penalidade: perde a prioridade e `lastInvitedAt` vai para `agora + queue.abandonPenaltyDays` (padrão: 30), o que mantém o dev no fim da fila.
- O contador `abandonments` entra na reputação (F9).

### Chat e auditoria

- O chat do contrato continua aberto em `DISPUTED` e `SETTLED`. A mediação analisa a conversa.
- Ações da mediação (decisão de contestação, decisão de disputa, abandono declarado) exigem `admin:disputes` (2FA) e são auditadas.
- O painel mostra o histórico de contratos por pessoa (`/v1/admin/users/{id}/contract-stats`).

## Consequências

- O reembolso parcial depende do provedor aceitar estorno parcial (o Stripe aceita). Valores já repassados ao freelancer não são estornados aqui. Chargeback depois da liberação continua sendo risco da plataforma (§10 risco 2).
- Disputa só pode ser aberta com o contrato em andamento. Depois da aprovação, o pagamento é liberado (decisão consciente: a aprovação encerra a custódia).
- A escolha de quanto reconhecer ao freelancer é manual. Modelos de decisão (ex.: por entregas aprovadas) podem vir depois.
