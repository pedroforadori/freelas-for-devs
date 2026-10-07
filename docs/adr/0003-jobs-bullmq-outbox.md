# ADR-0003: Jobs com BullMQ, Transactional Outbox e reconciliador

- **Status:** Aceito
- **Data:** 2026-10-07

## Contexto

Prazos (convites, pagamento, revisões, auto-aprovação) não podem ser perdidos nem executados duas vezes.

## Decisão

Eventos de domínio gravados em `outbox_event` na mesma transação. Um publisher os envia ao **BullMQ** (Redis), e os prazos viram delayed jobs. O Postgres guarda `*_deadline_at` como fonte da verdade, e um **cron reconciliador** (1 min) processa prazos vencidos. Todo consumer é idempotente (`jobId` determinístico + checagem de estado).

## Alternativas descartadas

**pg-boss**: válido, mas o Redis já é necessário. **Temporal**: exagerado para o MVP. **Cron puro**: impreciso.

## Consequências

Processo `api-worker` separado. Alerta quando o reconciliador encontra prazo vencido (sinal de job perdido).
