# ADR-0002: PostgreSQL 16 + Drizzle ORM

- **Status:** Aceito
- **Data:** 2026-10-07

## Contexto

Dinheiro em custódia, fila concorrente e máquinas de estado exigem transações ACID e locking expressivo. O domínio precisa ficar isolado do ORM.

## Decisão

Usar **PostgreSQL 16** com **Drizzle ORM** e migrações SQL versionadas via `drizzle-kit`. Acesso a dados só pelos repositórios da camada de infraestrutura, com mappers para entidades de domínio.

## Alternativas descartadas

**Prisma**: locks e CTEs exigem raw SQL, e os tipos tendem a vazar para o domínio. **MikroORM**: Unit of Work bom, mas pesado. **TypeORM**: manutenção irregular. **MongoDB**: precisamos de integridade relacional.

## Consequências

`FOR UPDATE SKIP LOCKED` e advisory locks ficam disponíveis de forma tipada. Mais SQL explícito para escrever, o que é aceitável.
