# ADR-0004: Chat em tempo real com Socket.IO + adapter Redis

- **Status:** Aceito
- **Data:** 2026-10-07

## Contexto

O chat entre cliente, freelancer e Admin precisa de tempo real, escala horizontal e moderação antes da entrega.

## Decisão

Gateway **Socket.IO** no NestJS com `@socket.io/redis-adapter`, autenticado pelo cookie no handshake e com autorização por room a cada `join`. A mensagem passa pelo `ContactDetector`, é persistida e só então emitida. Processo `api-realtime` deployável separadamente.

## Alternativas descartadas

**Pusher/Ably**: custo por conexão e dados com terceiros (LGPD). **SSE**: unidirecional. **ws puro**: reimplementaria rooms e reconexão.

## Consequências

Eventos WS tipados em `packages/contracts`. No front, os eventos atualizam o cache do TanStack Query.
