# ADR-0009: Contratos Zod compartilhados e OpenAPI gerado

- **Status:** Aceito
- **Data:** 2026-10-07

## Contexto

Validação em todas as fronteiras e um cliente tipado reutilizável pelo web e pelo mobile futuro.

## Decisão

Schemas **Zod** em `packages/contracts`, usados no front, no back e para gerar o **OpenAPI 3.1** (`zod-openapi`). Cada rota é declarada com `defineRoute` (método, caminho, schemas, permissão); a API a implementa com `@ContractRoute(rota)` + `@ValidRequest()`, e um interceptor valida a resposta contra o contrato. Não usamos `nestjs-zod` (sem suporte a Nest 12) — os decorators próprios têm ~100 linhas. `packages/api-client` é gerado com openapi-typescript + openapi-fetch. O CI detecta breaking changes (`oasdiff`).

## Alternativas descartadas

**class-validator**: duplica tipos. **tRPC**: não serve bem a mobile nativo nem a terceiros.

## Consequências

Uma única fonte de verdade para formatos de request e response.
