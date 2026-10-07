# ADR-0007: Estado no apps/web: TanStack Query + Zustand

- **Status:** Aceito
- **Data:** 2026-10-07

## Contexto

A plataforma é muito interativa (chat, fila, entregas) e precisa separar estado de servidor de estado de cliente.

## Decisão

**TanStack Query** para estado de servidor (sobre o `api-client` gerado; RSC para shell e prefetch). **Zustand** para estado de cliente mínimo (UI e rascunho de projeto persistido). **nuqs** para estado de URL. **React Hook Form + Zod** para formulários.

## Alternativas descartadas

**Redux Toolkit/RTK Query**: boilerplate e duplicação. **Context como store**: re-renders em cascata.

## Consequências

Eventos de WebSocket invalidam ou atualizam queries; não existe store paralelo de dados do servidor.
