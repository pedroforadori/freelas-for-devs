# ADR-0012: Comissão customizável e plano do freelancer gratuito no MVP

- **Status:** Aceito
- **Data:** 2026-10-07

## Contexto

O modelo de cobrança do plano estava em aberto. A comissão é a receita principal.

## Decisão

**Comissão**: percentual e quem paga (cliente, freelancer ou dividido) são `Settings` editáveis pelo Admin, com **snapshot no contrato** no momento da contratação. **Valor inicial: 10%.** **Plano do freelancer**: gratuito no MVP; nenhum módulo de billing é construído agora.

## Alternativas descartadas

Cobrança no primeiro pagamento, mensalidade e trial: reavaliar pós-MVP (opções em `architecture.md` §10).

## Consequências

Menor escopo no MVP e nenhuma barreira para iniciantes. A porta `BillingProvider` será desenhada quando a cobrança voltar à pauta.
