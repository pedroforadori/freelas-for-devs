# Rotação de segredos

| Segredo                                  | Como rotacionar sem derrubar sessões                                                                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JWT (`JWT_PRIVATE_KEY`)                  | Gere novo par com outro `JWT_KEY_ID`; mova a pública antiga para `JWT_PREVIOUS_PUBLIC_KEYS`; remova-a depois de 15 min (TTL do access token).                                                  |
| Cifra de campos (`FIELD_ENCRYPTION_KEY`) | Nova chave com novo `FIELD_ENCRYPTION_KEY_ID`; a antiga vai para `FIELD_ENCRYPTION_PREVIOUS_KEYS` (continua decifrando). Nunca descarte uma chave antiga enquanto houver dado cifrado com ela. |
| Stripe / Resend / Gemini / OAuth         | Gere no painel do provedor, atualize a variável, reimplante, revogue a antiga.                                                                                                                 |
| Banco / Redis                            | Crie a credencial nova, atualize, reimplante, revogue a antiga.                                                                                                                                |

Suspeita de vazamento: rotacione **antes** de investigar e siga o [incidente de segurança](./security-incident.md).
