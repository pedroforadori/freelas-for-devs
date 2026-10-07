# ADR-0011: Landing estática separada (apps/landing)

- **Status:** Aceito
- **Data:** 2026-10-07

## Contexto

SEO e performance são prioridade e não devem carregar o JS nem a autenticação da plataforma.

## Decisão

App Next.js à parte, 100% SSG e RSC, sem ilhas client na v1 (accordions com `<details>`), Space Grotesk via `next/font`, SVGs otimizados, analytics cookieless, JSON-LD e Lighthouse CI ≥ 95. Layout inspirado no template Positivus (Figma Community; tokens lidos via MCP e registrados em `architecture.md` §11) e práticas de conversão da RD Station. Lista de espera via `POST /v1/leads`.

## Alternativas descartadas

**Rotas de marketing dentro de apps/web**: misturaria bundles, autenticação e middleware.

## Consequências

Tokens de design compartilhados via `packages/ui`.
