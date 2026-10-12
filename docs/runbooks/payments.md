# Pagamentos e webhooks

| Sintoma                                                    | Causa provável                                                        | Ação                                                                                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cliente pagou e o contrato continua "Aguardando pagamento" | Webhook não chegou / assinatura inválida                              | Painel Stripe → Webhooks → reenviar o evento. O reconciliador consulta checkouts pendentes há mais de 15 min a cada 5 min. Conferir `STRIPE_WEBHOOK_SECRET`.          |
| Contrato aprovado sem repasse                              | Conta de recebimento do dev incompleta, ou saldo ainda não disponível | Admin → projeto → Contrato. O repasse é refeito a cada 15 min e quando a conta fica pronta.                                                                           |
| Disputa decidida "Aguardando: conta de recebimento"        | Dev sem conta pronta                                                  | O reembolso já saiu; o repasse sai sozinho quando a conta ficar pronta. Avisar o dev.                                                                                 |
| Saldo em custódia diferente do Stripe                      | Divergência                                                           | Admin → projeto → razão contábil (partidas dobradas); comparar com os pagamentos no Stripe; corrigir com lançamento compensatório auditado (nunca editar lançamento). |

Webhooks repetidos são ignorados (`webhook_events` com chave do provedor + id).
