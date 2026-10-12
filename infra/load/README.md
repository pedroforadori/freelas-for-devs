# Testes de carga (k6)

Roteiros para rodar **contra staging** antes do beta (docs/architecture.md §8). Não rode contra
produção nem contra o ambiente local do PGlite.

| Roteiro               | O que mede                                                                                  | Meta                                                   |
| --------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `chat-connections.js` | 1.000 conexões simultâneas no chat (Socket.IO), handshake autenticado e `conversation:join` | conexão p95 < 1 s; join p95 < 500 ms; > 99% de sucesso |
| `api-read-mix.js`     | leituras do painel de cliente e dev com 200 usuários                                        | p95 < 300 ms; erro < 1%                                |

## Como rodar

1. Instale o k6 (`brew install k6`).
2. Em staging, crie duas contas de teste (cliente e dev) e copie o cookie `f4d_at` de cada uma
   (DevTools → Application → Cookies). O token vale 15 min: gere logo antes de rodar.
3. Suba o limite de requisições de staging (`RATE_LIMIT_PER_MINUTE`) durante o teste.
4. Rode com 2 réplicas da API (o adapter Redis do Socket.IO precisa estar ativo).

```bash
k6 run -e API=https://api.staging... -e ORIGIN=https://app.staging... \
  -e CLIENT_COOKIE="f4d_at=..." -e DEV_COOKIE="f4d_at=..." infra/load/api-read-mix.js
k6 run -e API=wss://api.staging... -e ORIGIN=https://app.staging... \
  -e COOKIE="f4d_at=..." -e CONVERSATION=<uuid> infra/load/chat-connections.js
```

Registre o resultado (p95, erros, CPU/memória das réplicas, conexões do Postgres e do Redis)
no runbook de lançamento do beta.
