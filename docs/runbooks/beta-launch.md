# Lançamento do beta fechado

## Infra e contas (uma vez)

- [ ] Postgres gerenciado (Neon/Supabase) com PITR ligado; usuário da aplicação **sem DDL** e outro para migrações.
- [ ] Redis gerenciado (Upstash/Railway) com persistência.
- [ ] Cloudflare R2: buckets `quarentena` e `arquivos` privados; CORS só para o domínio do web (PUT).
- [ ] ClamAV acessível pela API (`MALWARE_SCAN=clamav`).
- [ ] Stripe em modo **live** com Connect Express habilitado para o Brasil; webhook apontando para `/v1/webhooks/payments` com os eventos de checkout e `account.updated`.
- [ ] Resend com domínio verificado (SPF, DKIM, DMARC).
- [ ] Gemini com chave de produção e cota (`ESTIMATOR=gemini`).
- [ ] Sentry (API e web) com DSN e release.
- [ ] OAuth GitHub e Google com as URLs de callback de produção.
- [ ] Cloudflare Turnstile para a lista de espera.

## Configuração da API (produção)

- [ ] `pnpm --filter @f4d/api keys:generate` → `JWT_KEY_ID`, `JWT_PRIVATE_KEY`.
- [ ] `FIELD_ENCRYPTION_KEY` (`openssl rand -base64 32`) guardada também no cofre de senhas.
- [ ] `COOKIE_SECURE=true`, `COOKIE_DOMAIN=.seu-dominio`, `CORS_ORIGINS` só com web e landing.
- [ ] `PAYMENTS_PROVIDER=stripe`, `MAIL_TRANSPORT=resend`, `NODE_ENV=production`.
- [ ] Processo worker rodando (`node dist/worker.js`) — sem ele, nada de eventos, prazos, repasses nem reputação.
- [ ] 2 réplicas da API (HTTP + Socket.IO) atrás do balanceador com WebSocket habilitado.

## Antes de abrir

- [ ] `pnpm db:migrate` no release job; `/v1/health/ready` verde.
- [ ] Admin criado com `pnpm --filter @f4d/api admin:provision --email … --name …` e 2FA ativado.
- [ ] Admin → Configurações: **Cadastro de novas contas = Só convidados**; revisar comissão, prazos e regras de nível.
- [ ] Rodar o [teste de carga](../../infra/load/README.md) em staging e registrar o resultado aqui.
- [ ] Rodar `infra/scripts/backup-restore-check.sh` e registrar o resultado.
- [ ] Pentest leve do [checklist](../security/owasp-checklist.md).
- [ ] Termos de uso e política de privacidade revisados por advogado e publicados.
- [ ] Fluxo completo em produção com valores reais baixos: publicar → escopo → proposta → pagar (Pix/cartão) → entregar → aprovar → repasse → reembolso de teste.

## Abrir

- [ ] Admin → Beta: convidar a primeira leva (sugestão: 10 clientes e 30 devs).
- [ ] Acompanhar por 48 h: Sentry, filas, razão contábil, moderação e disputas.
