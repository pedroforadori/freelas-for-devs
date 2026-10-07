# ADR-0008: Porta PaymentGateway com Stripe Connect como primeiro adapter

- **Status:** Aceito
- **Data:** 2026-10-07

## Contexto

Custódia e split são obrigatórios. O Stripe foi pedido, mas o Connect no Brasil não tem escrow nativo e há risco regulatório.

## Decisão

O domínio depende da porta `PaymentGateway` (charge, transfer, refund, onboarding, parse de webhook). Primeiro adapter: **Stripe Connect Express** com _separate charges and transfers_. Ledger interno de partidas dobradas em centavos. Webhooks com verificação de assinatura e idempotência por `event.id`.

## Alternativas descartadas

**Somente Stripe, acoplado**: troca futura cara. **Gateway BR primeiro**: considerado; fica como adapter futuro.

## Consequências

Validar com o Stripe BR o prazo de retenção, Pix e KYC, e com um advogado a questão BACEN, antes da F6.
