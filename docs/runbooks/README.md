# Runbooks

Procedimentos para operar a plataforma. Cada um diz **como perceber**, **o que fazer** e **como confirmar**.

| Runbook                                          | Quando usar                                                    |
| ------------------------------------------------ | -------------------------------------------------------------- |
| [Lançamento do beta](./beta-launch.md)           | Checklist antes de abrir para os primeiros usuários            |
| [Deploy e rollback](./deploy-rollback.md)        | Toda publicação; reverter uma versão ruim                      |
| [Migrações de banco](./migrations.md)            | Alterar o schema sem derrubar a API                            |
| [Backup e restauração](./backup-restore.md)      | Teste mensal do backup; recuperar dados                        |
| [Pagamentos e webhooks](./payments.md)           | Pagamento não confirmado, repasse parado, divergência no razão |
| [Filas, outbox e Redis](./queues-outbox.md)      | Eventos atrasados, jobs falhando, Redis fora                   |
| [Rotação de segredos](./secrets-rotation.md)     | Chave vazada ou rotação periódica                              |
| [Pedidos LGPD](./lgpd-requests.md)               | Titular pede acesso, correção ou exclusão por e-mail           |
| [Incidente de segurança](./security-incident.md) | Suspeita de invasão ou vazamento                               |
