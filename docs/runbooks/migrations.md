# Migrações de banco

- Gere com `pnpm db:generate` a partir de `apps/api/src/db/schema`; revise o SQL; **nunca** edite migração já aplicada.
- Em produção valem só migrações compatíveis com a versão em execução (**expand → migrate → contract**):
  1. _expand_: adicionar coluna/tabela nullable ou com default;
  2. _migrate_: deploy do código que escreve nos dois formatos + backfill em lotes;
  3. _contract_: remover o antigo em um deploy posterior.
- Índices em tabelas grandes: `CREATE INDEX CONCURRENTLY` em migração separada (fora de transação).
- Seeds de configuração (ex.: regras de nível) usam `WHERE ... IS NULL`/`ON CONFLICT` para serem idempotentes.
- Teste a migração restaurando um backup recente (script de [backup](./backup-restore.md)) e aplicando nele.
