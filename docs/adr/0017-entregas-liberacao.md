# ADR-0017: Entregas em rodadas, aprovação e liberação do pagamento (F7)

- **Status:** Aceito
- **Data:** 2026-10-11

## Contexto

Com o pagamento em custódia (ADR-0016), o contrato precisa conduzir o trabalho até a aprovação. O fluxo segue a §4.3: 1ª entrega completa, uma lista única de ajustes, 2ª entrega, ajustes residuais e entrega final. Sem resposta do cliente no prazo, a revisão avança. A liberação repassa o líquido ao freelancer.

## Decisão

- **Duas máquinas de estado no agregado `Contract`:**
  - Status: AWAITING_PAYMENT → ACTIVE → APPROVED → RELEASED.
  - Etapa das entregas: WORKING_D1 → REVIEW_D1 → WORKING_D2 → REVIEW_D2 → WORKING_FINAL → FINAL_REVIEW.
  - O cliente pode aprovar em qualquer revisão (aprovação antecipada).
- **Ajustes e correção:**
  - Os ajustes recebem id.
  - A correção pontual da entrega final só pode citar ajustes já pedidos. Pedido novo é fora de escopo (F8).
  - O limite de correções vem da configuração `delivery.finalCorrectionsMax` (padrão 1).
- **Prazos copiados no pagamento:** revisão das entregas 1 e 2 (5 dias), aprovação automática da final (7 dias) e limite de correções. Um reconciliador a cada minuto processa as revisões vencidas: as entregas 1 e 2 avançam sem ajustes, e a final é aprovada automaticamente.
- **Aprovação** (do cliente ou automática): conclui o projeto (`COMPLETED`, pela fachada de projetos) e publica `ContractApproved`. O worker então libera o pagamento.
- **Liberação:**
  - Transferência ao freelancer (Stripe `transfers`, com `transfer_group` do contrato e chave de idempotência) e os lançamentos `RELEASE` (ESCROW → FREELANCER_PAYABLE + PLATFORM_REVENUE) e `PAYOUT` (FREELANCER_PAYABLE → GATEWAY_CLEARING), tudo na mesma transação.
  - Sem conta de recebimento pronta, o contrato fica APPROVED. O repasse é tentado de novo quando a conta fica pronta (webhook `account.updated`), a cada 15 min e sempre que o status da conta é consultado no provedor, para cobrir o caso de o aviso se perder.
- **Arquivos:** concessão de leitura por arquivo (`file_access_grants`). Os arquivos da entrega ficam legíveis pelo cliente, e os anexos do projeto pelos freelancers convidados. Fora disso, só o dono e o Admin leem.
- **Avaliação:** o cliente avalia o trabalho (1 a 5 e comentário, uma vez por contrato) depois da aprovação. É a base da reputação da F9.

## Consequências

- Os timers não pausam ainda. A pausa durante disputa ou fora de escopo pendente entra na F8.
- Com saldo ainda indisponível no Stripe (prazo de liquidação), a transferência falha e o reconciliador repete. Validar no modo de teste o prazo real de disponibilidade no Brasil.
- A avaliação do freelancer sobre o cliente fica em aberto (pergunta 8 da §10).
