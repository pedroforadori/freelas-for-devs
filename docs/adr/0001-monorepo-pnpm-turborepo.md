# ADR-0001: Monorepo com pnpm workspaces + Turborepo

- **Status:** Aceito
- **Data:** 2026-10-07

## Contexto

Três apps (web, api, landing) e pacotes compartilhados precisam de builds rápidos, cache e instalação estrita.

## Decisão

Usar **pnpm workspaces** + **Turborepo**, com pipelines `lint`, `typecheck`, `test` e `build`, cache remoto na Vercel e execução só no que foi afetado (`--affected`).

## Alternativas descartadas

**Nx**: poderoso, mas opinativo e com curva maior. **npm/yarn workspaces puros**: sem cache nem orquestração de tarefas.

## Consequências

Configuração mínima. Fronteiras entre pacotes garantidas pelo ESLint (`eslint-plugin-boundaries`), não pela ferramenta de monorepo.
