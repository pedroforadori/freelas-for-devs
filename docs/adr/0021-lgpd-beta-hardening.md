# ADR-0021: LGPD, beta fechado e hardening (F11)

- **Status:** Aceito
- **Data:** 2026-10-12

## Contexto

Para abrir o beta fechado (§9, F11) faltavam quatro coisas:

- os direitos do titular (LGPD art. 18) e a retenção de dados;
- um jeito de limitar quem cria conta;
- a evidência de que os controles de segurança cobrem todas as rotas;
- o material de operação: carga, backup e runbooks.

## Decisão

### Exportação

- `GET /v1/me/data-export` devolve um JSON (`freelas4devs-export/v1`) com conta, perfis, projetos, convites e propostas, contratos e entregas, avaliações, disputas (só as manifestações da própria pessoa), mensagens enviadas, arquivos, lista de espera e os últimos 500 eventos de auditoria.
- Nada de segredo sai: hash de senha, tokens e cifras ficam de fora, e um teste garante isso.
- O acesso fica na auditoria.

### Exclusão por anonimização (módulo `privacy`)

- **Bloqueios:** contrato em aberto (pagamento, entregas, disputa ou repasse pendente), projeto em andamento e contas de Admin.
- **O que é feito:**
  - o usuário passa a `DELETED`, com e-mail `excluida-<id>@contas.invalid`, nome "Conta excluída" e sem senha;
  - sessões revogadas;
  - vínculos sociais e 2FA apagados;
  - perfis esvaziados;
  - lista de espera e convite removidos.
- **O que fica, sem identificar a pessoa:** contratos, pagamentos, razão e auditoria (obrigação legal), e as mensagens enviadas, para quem as recebeu.
- `identity.UserDeleted` tira a pessoa da fila, como na suspensão.
- Senha obrigatória quando a conta tem senha, além da frase de confirmação.

### Retenção diária (04:00)

- Texto original das tentativas de passar contato: `privacy.violationOriginalRetentionDays`, padrão 180 dias.
- Tokens de uso único e de sessão vencidos: 30 dias.
- Outbox publicado: 30 dias.
- Webhooks: 90 dias.
- A auditoria **não** é apagada (Marco Civil: mínimo de 6 meses; prazo máximo a definir com o jurídico).

### Beta fechado

- Configuração `access.signupMode` (`OPEN` | `INVITE_ONLY`), alterável em Admin → Configurações.
- Com `INVITE_ONLY`, só e-mails em `beta_invites` criam conta, tanto por senha quanto por login social (`/entrar?erro=beta-fechado`).
- O Admin convida pela lista de espera (`/admin/beta`) ou por e-mail direto. O convite chega por e-mail com o endereço já preenchido no cadastro.
- Contas existentes não são afetadas.
- O padrão do código é `OPEN` (para dev e testes). **Em produção, a configuração deve ser trocada antes de abrir** (runbook de lançamento).

### Segurança

- `security.e2e` percorre **todas** as rotas do contrato e verifica três coisas:
  - sem sessão → 401;
  - rotas de Admin para cliente ou dev → 403;
  - rotas de Admin sem 2FA → 403.
- Também cobre IDOR, campos extras (mass assignment), corpo grande e erros sem detalhes internos.
- Toda rota nova entra no teste automaticamente.
- O checklist OWASP fica em `docs/security/owasp-checklist.md`.
- `@f4d/config-eslint` passou a declarar as ferramentas de lint como `devDependencies`: o `pnpm audit --prod` do CI deixou de acusar o `braces` (sem versão corrigida), que é só de lint.

### Operação

- k6 em `infra/load/`: 1.000 conexões no chat e mistura de leituras.
- Verificação de backup em `infra/scripts/backup-restore-check.sh`: restaura o dump, compara contagens e confere as invariantes do razão.
- Runbooks em `docs/runbooks/`.

## Consequências

- Arquivos enviados pela pessoa (anexos, entregas) continuam guardados após a exclusão: são parte de contratos e projetos de terceiros. Apagar arquivos de portfólio ou de projetos nunca contratados fica para depois.
- **Ainda não executados** (sem Docker, k6 nem ferramentas do Postgres nesta máquina): o teste de carga, a verificação de backup e o pentest com ZAP. Os roteiros estão prontos e o runbook de lançamento exige rodá-los.
