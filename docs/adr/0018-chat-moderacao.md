# ADR-0018: Chat em tempo real e moderação de contato (F3)

- **Status:** Aceito
- **Data:** 2026-10-11

## Contexto

Cliente, especialista e freelancer precisam conversar dentro da plataforma: no escopo (antes da fila) e durante o contrato. A principal ameaça ao negócio é a desintermediação: passar telefone, e-mail ou perfil para combinar e pagar por fora. Isso tira a proteção da custódia e da mediação (§5, §10 risco 5).

## Decisão

- **Duas conversas por projeto:**
  - **Escopo:** cliente ↔ equipe de especialistas (qualquer Admin), aberta enquanto o projeto está entre `ESTIMATING` e `DISTRIBUTING`.
  - **Contrato:** cliente ↔ freelancer contratado, aberta só depois do pagamento em custódia (`ACTIVE`, `APPROVED`, `RELEASED`). O Admin lê e pode escrever para mediar.
  - A lista de status fica em `@f4d/contracts` (`SCOPING_CHAT_STATUSES`, `CONTRACT_CHAT_STATUSES`) e vale para API e web. Quem não participa recebe 404 (não revela que a conversa existe).
  - O especialista aparece como "Especialista Freelas 4 Devs": o nome do Admin não é exposto.
- **Envio só por HTTP; o socket só entrega.** A mensagem passa pela triagem, é gravada na transação e só depois é emitida (`message:new`) para a sala `conversation:{id}`. Nada aparece em tempo real sem estar no banco. A emissão é melhor esforço; sem socket, o web consulta a cada 10 s.
- **Socket.IO no mesmo processo HTTP** (namespace `/chat`), com `@socket.io/redis-adapter` em produção para várias réplicas:
  - A autenticação acontece num middleware do handshake: o mesmo cookie de sessão (ou `auth.token` Bearer para o app mobile). Com cookie, a origem precisa estar em `CORS_ORIGINS` (contra CSWSH).
  - `conversation:join` confere a participação a cada entrada.
  - `maxHttpBufferSize` de 64 KB.
- **Triagem (`ScreenText`)** de mensagens do chat e do texto das propostas:
  - `RegexContactDetector`: telefone BR, inclusive por extenso ("nove nove", "meia"); e-mail com "arroba"/"(at)" e espaços; URLs e domínios, inclusive "ponto com"; @handles; nomes de apps de mensagem e frases como "me chama no".
  - Hosts de trabalho permitidos: GitHub, GitLab, Bitbucket, Figma, Vercel, Netlify e Loom.
  - O trecho vira `[contato removido]` e o remetente vê um aviso. O original fica cifrado (AES-GCM) em `contact_violations`.
  - Corpus de testes com 22 tentativas reais: 100% mascaradas.
- **Reincidência** (janela de 30 dias): na N-ésima tentativa (`moderation.warnAfterViolations`, padrão 2), a pessoa recebe advertência automática por e-mail, registrada em `moderation_actions`. O painel `/admin/moderacao` mostra a contagem e destaca quem repete.
- **Ações do Admin** (permissão `admin:moderation`, exige 2FA):
  - Ver o original é uma rota POST auditada (`admin.violation_revealed`).
  - Suspender: bloqueia o login e revoga os refresh tokens. O evento `identity.UserSuspended` faz a distribuição anular convites, propostas e esperas abertos e repor as vagas. A elegibilidade da fila já exige conta ativa.
  - Reativar desfaz a suspensão. Tudo fica auditado e a pessoa é avisada por e-mail.

## Consequências

- O access token em uso continua válido por até 15 minutos depois da suspensão. Se isso for curto demais, checar o status no guard (custo: uma leitura por requisição ou cache no Redis).
- O regex é contornável. A porta `ContactDetector` permite somar um detector por LLM sem mudar quem chama.
- Uma escolha de proposta já aguardando pagamento não é desfeita pela suspensão: fica para o Admin decidir.
- `moderation.alertAfterViolations` existe nas configurações, mas o alerta ativo ao Admin (e-mail/notificação) ainda não foi implementado. Por enquanto, o painel lista os reincidentes.
