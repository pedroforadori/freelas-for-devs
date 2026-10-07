# Freelas 4 Devs

Marketplace de freelancers focado em desenvolvimento de software, com uma fila de distribuição
por nível que ajuda iniciantes a conseguir o primeiro projeto, sem vantagem competitiva paga.

- Arquitetura e plano do MVP: [`docs/architecture.md`](docs/architecture.md)
- Decisões (ADRs): [`docs/adr/`](docs/adr/README.md)

## Estrutura

| Caminho               | O que é                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `apps/api`            | API NestJS 12 (Fastify) em camadas: `domain` → `application` → `infrastructure` / `interface` |
| `apps/web`            | Plataforma (Next.js 16, App Router, TanStack Query, Zustand, nuqs)                            |
| `apps/landing`        | Landing page estática (Next.js 16, SSG)                                                       |
| `packages/contracts`  | Schemas Zod, rotas e códigos de erro; gera `openapi.json`                                     |
| `packages/api-client` | Cliente HTTP tipado gerado do OpenAPI (web e mobile futuro)                                   |
| `packages/ui`         | Tokens de design (Tailwind v4) e componentes compartilhados                                   |
| `packages/config-*`   | Configurações de TypeScript e ESLint                                                          |
| `infra/`              | docker-compose local e Dockerfile de deploy                                                   |

## Pré-requisitos

- Node.js 22 (`.nvmrc`) e pnpm 12 (`npm i -g pnpm@12` ou `corepack enable`)
- Docker (ou OrbStack) para Postgres, Redis, MinIO e Mailpit locais e para os testes de integração

## Primeiros passos

```bash
pnpm install
cp .env.example apps/api/.env          # e ajuste se necessário
pnpm infra:up                          # Postgres, Redis, MinIO, Mailpit
pnpm build && pnpm db:migrate          # aplica as migrações
pnpm dev                               # api :3333 · web :3000 · landing :3001
pnpm --filter @f4d/api dev:worker      # worker (relay do outbox) em outro terminal
```

- API: <http://localhost:3333/v1/health> · OpenAPI em `/v1/openapi.json` (fora de produção)
- Web: <http://localhost:3000> · Landing: <http://localhost:3001> · E-mails: <http://localhost:8025>

## Comandos

| Comando                                      | Faz                                                             |
| -------------------------------------------- | --------------------------------------------------------------- |
| `pnpm build` / `lint` / `typecheck` / `test` | Pipelines via Turborepo (com cache)                             |
| `pnpm test:integration`                      | Testes com Postgres/Redis reais (Testcontainers; requer Docker) |
| `pnpm format`                                | Prettier em todo o repositório                                  |
| `pnpm db:generate`                           | Gera migração SQL a partir de `apps/api/src/db/schema`          |
| `pnpm db:migrate`                            | Aplica migrações pendentes                                      |

## Convenções

- **Fronteiras de camada** são verificadas pelo ESLint e por `apps/api/src/architecture.test.ts`:
  `domain` e `application` não importam frameworks nem infraestrutura.
- **Novas rotas** nascem em `packages/contracts` (`defineRoute`) e são implementadas na API com
  `@ContractRoute(...)` + `@ValidRequest()`; o OpenAPI e o `api-client` são regenerados no build.
- **Erros** seguem RFC 9457 (`application/problem+json`) com `code` estável.
- **Dinheiro** sempre em centavos inteiros (`Money`); percentuais em basis points.
- **Commits** no padrão Conventional Commits.
