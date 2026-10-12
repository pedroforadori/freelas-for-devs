#!/usr/bin/env bash
# Verifica que um backup do Postgres RESTAURA e está íntegro (backup que não restaura não é backup).
#
#   SOURCE_URL=postgres://...produção-ou-réplica...  \
#   SCRATCH_URL=postgres://...servidor-de-teste.../postgres \
#   infra/scripts/backup-restore-check.sh
#
# 1. pg_dump do SOURCE_URL (formato custom); 2. cria um banco temporário no servidor do
# SCRATCH_URL e restaura nele; 3. compara contagens por tabela e checa invariantes de negócio
# (razão contábil balanceado, custódia nunca negativa); 4. apaga o banco temporário.
# Requer pg_dump/pg_restore/psql da mesma versão major do servidor (16). Saída != 0 = falhou.
set -euo pipefail

: "${SOURCE_URL:?defina SOURCE_URL}"
: "${SCRATCH_URL:?defina SCRATCH_URL (banco administrativo do servidor de teste)}"

STAMP=$(date +%Y%m%d%H%M%S)
TEMP_DB="f4d_restore_check_${STAMP}"
DUMP=$(mktemp -t f4d-backup-XXXXXX).dump
TEMP_URL="${SCRATCH_URL%/*}/${TEMP_DB}"
cleanup() {
  psql "$SCRATCH_URL" -qc "DROP DATABASE IF EXISTS ${TEMP_DB}" >/dev/null 2>&1 || true
  rm -f "$DUMP"
}
trap cleanup EXIT

echo "→ dump de ${SOURCE_URL%%@*}@…"
pg_dump --format=custom --no-owner --no-privileges --file "$DUMP" "$SOURCE_URL"
echo "  $(du -h "$DUMP" | cut -f1)"

echo "→ restaurando em ${TEMP_DB}"
psql "$SCRATCH_URL" -qc "CREATE DATABASE ${TEMP_DB}"
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$TEMP_URL" "$DUMP"

COUNTS="select 'users', count(*) from users union all select 'projects', count(*) from projects
  union all select 'contracts', count(*) from contracts union all select 'payments', count(*) from payments
  union all select 'ledger_entries', count(*) from ledger_entries union all select 'messages', count(*) from messages
  union all select 'audit_log', count(*) from audit_log order by 1"
echo "→ comparando contagens"
diff <(psql "$SOURCE_URL" -Atc "$COUNTS") <(psql "$TEMP_URL" -Atc "$COUNTS") \
  && echo "  contagens iguais" || { echo "✗ contagens diferentes"; exit 1; }

echo "→ invariantes"
UNBALANCED=$(psql "$TEMP_URL" -Atc "select count(*) from (select journal_id from ledger_entries
  group by journal_id having sum(debit_cents) <> sum(credit_cents)) j")
NEGATIVE=$(psql "$TEMP_URL" -Atc "select count(*) from (select contract_id from ledger_entries
  where account = 'ESCROW' group by contract_id having sum(credit_cents - debit_cents) < 0) e")
MIGRATIONS=$(psql "$TEMP_URL" -Atc "select count(*) from drizzle.__drizzle_migrations")
echo "  lançamentos desbalanceados: ${UNBALANCED} · custódias negativas: ${NEGATIVE} · migrações: ${MIGRATIONS}"
[ "$UNBALANCED" = "0" ] && [ "$NEGATIVE" = "0" ] || { echo "✗ invariantes violadas"; exit 1; }

echo "✓ backup restaurado e íntegro ($(date -u +%FT%TZ))"
