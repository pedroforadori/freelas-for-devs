# ADR-0016: Contratação, pagamento em custódia e razão contábil (F6)

- **Status:** Aceito
- **Data:** 2026-10-09

## Contexto

A escolha da proposta (F5) precisa virar contrato e pagamento em custódia: o dinheiro fica na plataforma até a aprovação da entrega final (F7). É dinheiro de terceiros, então o sistema tem de ser confiável mesmo com webhook perdido ou repetido, corrida entre pagar e cancelar e falha do provedor.

## Decisão

- **Módulo `contracts`:** contrato, pagamento, razão contábil e conta de recebimento ficam juntos para que a confirmação seja uma única transação (custódia + projeto em andamento). As entregas da F7 estendem o mesmo módulo.
- **Porta `PaymentGateway` (ADR-0008):** dois adapters.
  - `StripePaymentGateway`: Checkout Session, separate charges and transfers, `transfer_group` por contrato, Connect Express no Brasil para os freelancers.
  - `FakePaymentGateway` (`PAYMENTS_PROVIDER=fake`): checkout simulado em `/pagamento-simulado`, para desenvolvimento e testes. O schema de ambiente proíbe esse adapter em produção.
- **Snapshot no contrato:** comissão e quem paga, valor da proposta e prazo de pagamento. A conta é `cliente paga = freelancer recebe + comissão`, sem perder centavo (`Money.allocate`).
- **Checkout:**
  - Um checkout aberto é reaproveitado.
  - Cada checkout novo leva chave de idempotência.
  - A validade vai de 31 min até o menor entre 23 h e o prazo do contrato. O prazo de pagamento do contrato (72 h) é maior que a vida máxima de um checkout do Stripe (24 h), então o cliente pode abrir outro dentro do prazo.
- **Webhook:**
  - Assinatura verificada sobre o corpo cru (`rawBody`).
  - O evento é registrado em `webhook_events` (único por provedor + id) e processado na mesma transação. Se o processamento falhar, a reentrega do provedor tenta de novo.
  - Pix e boleto só confirmam no `async_payment_succeeded`.
- **O provedor é a fonte da verdade:** um pagamento confirmado depois de fechado localmente (contrato expirado ou cancelado, valor divergente) é aceito e reembolsado na hora. O reembolso ao provedor roda dentro da transação, com chave de idempotência.
- **Razão em partidas dobradas** (`ledger_entries`, só acréscimos):
  - `FUNDING`: GATEWAY_CLEARING → ESCROW.
  - `REFUND`: inverso do FUNDING.
  - `RELEASE` (F7): ESCROW → FREELANCER_PAYABLE + PLATFORM_REVENUE.
  - Lançamento desbalanceado é recusado no domínio.
- **Prazos e reconciliação** (job schedulers):
  - A cada minuto, contratos não pagos no prazo expiram: os checkouts são fechados, a escolha é desfeita (a distribuição reabre a rodada e o escolhido ganha prioridade) e o cliente é avisado.
  - A cada 5 minutos, pagamentos pendentes há mais de 15 min são consultados no provedor (cobre webhook perdido).
- **Entre módulos:**
  - `distribution.ProposalSelected` → contrato.
  - `contracts.ContractFunded` → `FinalizeHiring`.
  - `contracts.ContractExpired` → `RevertSelection`.
  - O estado do projeto (`IN_PROGRESS`, volta a `DISTRIBUTING`) muda pela `ProjectsFacade`.
- **Conta de recebimento:** opcional para receber convites e obrigatória antes do primeiro repasse (F7). Dados bancários e documentos ficam só no provedor.

## Consequências

- Falta validar no Stripe real (modo de teste): Connect Express no Brasil, o modelo de cobrança separada com repasse posterior, Pix e o prazo de retenção do saldo antes da transferência. Se o modelo não for suportado, entra outro adapter na mesma porta.
- As taxas do provedor ainda não são lançadas no razão. Entram junto com o repasse (F7), a partir das balance transactions.
- Reter dinheiro de terceiros pode ter implicação regulatória (arranjos de pagamento, BACEN): validar com um advogado antes de cobrar clientes reais.
