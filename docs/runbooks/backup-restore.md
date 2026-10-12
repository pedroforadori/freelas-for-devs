# Backup e restauração

**Política:** PITR do provedor (7 dias no mínimo) + dump lógico diário guardado fora do provedor (R2, 30 dias).

## Teste mensal (obrigatório)

```bash
SOURCE_URL=<réplica de leitura> SCRATCH_URL=<servidor de teste>/postgres infra/scripts/backup-restore-check.sh
```

O script restaura o dump num banco temporário, compara contagens e checa as invariantes do razão
(lançamentos balanceados, custódia nunca negativa). Registre data, duração e resultado abaixo.

| Data | Tamanho | Duração | Resultado           | Quem |
| ---- | ------- | ------- | ------------------- | ---- |
| —    | —       | —       | ainda não executado | —    |

## Restaurar em produção

1. Pare o worker (evita processar eventos sobre dados que serão substituídos).
2. Restaure por PITR para um **novo** banco no instante anterior ao incidente.
3. Rode o script de verificação contra o banco restaurado.
4. Aponte `DATABASE_URL` para o novo banco, suba API e worker.
5. Reconcilie com o Stripe: pagamentos e repasses do intervalo perdido (reconciliador roda sozinho a cada 5 min; confira o painel do Stripe).
