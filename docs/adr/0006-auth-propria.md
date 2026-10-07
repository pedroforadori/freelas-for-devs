# ADR-0006: Autenticação própria no NestJS

- **Status:** Aceito
- **Data:** 2026-10-07

## Contexto

RBAC fino, futuro papel de Gerente de Projetos, futuro app mobile e LGPD.

## Decisão

argon2id; **access JWT de 15 min** + **refresh opaco rotativo** com detecção de reuso por família; cookies httpOnly/Secure/SameSite=Lax; CSRF por double-submit + checagem de Origin; OAuth GitHub/Google; **2FA TOTP obrigatório para Admin**. O mobile futuro usa os mesmos endpoints com tokens no corpo e `Authorization: Bearer`.

## Alternativas descartadas

**Clerk/Auth0**: custo, lock-in e dados fora. **Better Auth/NextAuth**: acoplam a autenticação ao Next. **Keycloak**: ops pesado.

## Consequências

Mais código de segurança sob nossa responsabilidade, mitigado por testes dedicados e pelo checklist OWASP.
