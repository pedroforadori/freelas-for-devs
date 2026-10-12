# Deploy e rollback

## Deploy

1. `main` verde no CI (qualidade, integração, Lighthouse, segurança).
2. Tag `vX.Y.Z` → build da imagem `infra/deploy/api.Dockerfile` (o mesmo artefato serve API e worker).
3. **Release job** aplica migrações (`node dist/db/migrate.js`, com `MIGRATION_DATABASE_URL`).
4. Rollout da API (réplicas uma a uma; o healthcheck usa `/v1/health`) e depois do worker.
5. Web e landing publicam pela Vercel a partir do mesmo commit.

**Confirmar:** `/v1/health/ready` 200; Sentry sem pico de erros em 10 min; fila `domain-events` drenando.

## Rollback

- **Só código:** reimplante a imagem anterior (API e worker). Migrações seguem _expand → migrate → contract_: a versão anterior funciona com o schema novo.
- **Migração com problema:** não reverta com DROP. Escreva uma migração corretiva (forward fix). Se houve perda de dados, use o PITR ([backup e restauração](./backup-restore.md)).
- **Web:** "Promote to production" do deploy anterior na Vercel.
