# Filas, outbox e Redis

- **Eventos atrasados** (ex.: projeto parado em "Gerando estimativa"): o worker está de pé? `select count(*) from outbox_events where published_at is null` crescendo = relay parado. Reinicie o worker.
- **Jobs falhando:** erros vão ao Sentry (QueueErrorReporter). Jobs são idempotentes: é seguro reprocessar.
- **Redis fora:** a API continua (rate limit em fail-open, chat cai para atualização a cada 10 s). Prazos não se perdem: estão no banco e os reconciliadores retomam quando o Redis volta. Agendamentos (cron) são recriados no boot do worker.
- **Jobs noturnos:** reputação (03:00) e retenção (04:00), horário de Brasília. Para rodar a reputação na hora: Admin → Níveis → Recalcular agora.
