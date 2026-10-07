# ADR-0006: Autenticação própria no NestJS

- **Status:** Aceito
- **Data:** 2026-10-07

## Contexto

RBAC fino, futuro papel de Gerente de Projetos, futuro app mobile e LGPD.

## Decisão

argon2id; **access JWT de 15 min** + **refresh opaco rotativo** com detecção de reuso por família; cookies httpOnly/Secure/SameSite=Lax; CSRF por double-submit + checagem de Origin; OAuth GitHub/Google; **2FA TOTP obrigatório para Admin**. O mobile futuro usa os mesmos endpoints com tokens no corpo e `Authorization: Bearer`.

## Alternativas descartadas

**Clerk/Auth0**: custo, lock-in e dados fora. **Better Auth/NextAuth**: acoplam a autenticação ao Next. **Keycloak**: ops pesado.

## Detalhes de implementação (F1)

- **Rotação com tolerância entre abas:** reapresentar um refresh token já rotacionado há mais de 10 s revoga a sessão inteira (roubo). Dentro de 10 s, a API responde **409** sem limpar cookies (outra aba acabou de renovar) e o cliente repete a requisição.
- **CSRF:** `GET /v1/auth/csrf` emite o cookie; toda requisição mutável com cookies exige `x-csrf-token` igual ao cookie e `Origin` permitida. Clientes nativos (sem cookies, com Bearer ou `x-f4d-client: mobile`) são dispensados.
- **Negação por padrão:** handler sem `@ContractRoute` nem `@Public()` responde 403.
- **Permissões administrativas exigem 2FA** (`aal=2` no token); o fluxo de 2FA chega na etapa 2 da F1.
- **2FA (TOTP):** segredo cifrado (AES-256-GCM), replay bloqueado por passo de tempo, 10 códigos de recuperação de uso único. Obrigatório e não desativável para Admin; Admin só é criado via CLI (`admin:provision`).
- **Login social (GitHub/Google):** `state` + PKCE em cookie cifrado de 10 min; destino final restrito a caminhos internos; vínculo por e-mail só com e-mail verificado pelo provedor. Se a conta local não estava verificada, a senha é descartada e as sessões revogadas (defesa contra _pre-account hijacking_). Contas com 2FA recebem o desafio no fragmento da URL (`#desafio=`), fora de logs e do Referer. O fluxo mobile (PKCE com esquema próprio) fica para quando houver app.
- **Redis indisponível:** rate limit e bloqueio de login entram em _fail-open_ (com log e readiness degradado) — a API não trava nem recusa tudo. O cliente Redis da aplicação não enfileira comandos offline (timeout de 500 ms).

## Consequências

Mais código de segurança sob nossa responsabilidade, mitigado por testes dedicados e pelo checklist OWASP.
