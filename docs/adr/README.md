# Architecture Decision Records — Freelas 4 Devs

| #    | Decisão                                                                                         | Status                      |
| ---- | ----------------------------------------------------------------------------------------------- | --------------------------- |
| 0001 | [Monorepo com pnpm workspaces + Turborepo](./0001-monorepo-pnpm-turborepo.md)                   | Aceito                      |
| 0002 | [PostgreSQL 16 + Drizzle ORM](./0002-postgresql-drizzle.md)                                     | Aceito                      |
| 0003 | [Jobs com BullMQ, Transactional Outbox e reconciliador](./0003-jobs-bullmq-outbox.md)           | Aceito                      |
| 0004 | [Chat em tempo real com Socket.IO + adapter Redis](./0004-realtime-socketio.md)                 | Aceito                      |
| 0005 | [Arquivos no Cloudflare R2 com quarentena](./0005-storage-r2.md)                                | Aceito                      |
| 0006 | [Autenticação própria no NestJS](./0006-auth-propria.md)                                        | Aceito                      |
| 0007 | [Estado no apps/web: TanStack Query + Zustand](./0007-estado-web.md)                            | Aceito                      |
| 0008 | [Porta PaymentGateway com Stripe Connect como primeiro adapter](./0008-payment-gateway-port.md) | Aceito                      |
| 0009 | [Contratos Zod compartilhados e OpenAPI gerado](./0009-contratos-openapi.md)                    | Aceito                      |
| 0010 | [Máquinas de estado declarativas no domínio](./0010-maquinas-de-estado.md)                      | Aceito                      |
| 0011 | [Landing estática separada (apps/landing)](./0011-landing.md)                                   | Aceito                      |
| 0012 | [Comissão customizável e plano do freelancer gratuito no MVP](./0012-monetizacao-mvp.md)        | Aceito                      |
| 0013 | [Estimativa de projetos com IA assíncrona e revisada por humano](./0013-estimativa-ia.md)       | Aceito (provedor: ver 0014) |
| 0014 | [Gemini como provedor padrão da estimativa](./0014-gemini-estimativa.md)                        | Aceito                      |
| 0015 | [Implementação da fila justa (F5)](./0015-distribuicao-implementacao.md)                        | Aceito                      |
| 0016 | [Contratação, pagamento em custódia e razão contábil (F6)](./0016-pagamentos-custodia.md)       | Aceito                      |
| 0017 | [Entregas em rodadas, aprovação e liberação do pagamento (F7)](./0017-entregas-liberacao.md)    | Aceito                      |
| 0018 | [Chat em tempo real e moderação de contato (F3)](./0018-chat-moderacao.md)                      | Aceito                      |
| 0019 | [Fora de escopo, disputas e abandono (F8)](./0019-fora-de-escopo-disputas.md)                   | Aceito                      |
| 0020 | [Reputação, score e progressão de nível (F9)](./0020-reputacao-niveis.md)                       | Aceito                      |

Novo ADR: copie o formato acima, numere sequencialmente e nunca edite a decisão de um ADR aceito. Para mudar uma decisão, crie um ADR que a substitua.
